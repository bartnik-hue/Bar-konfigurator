import * as THREE from 'three';

/**
 * Zarządca podświetlenia LED dla obiektów z materiałem 'LED'.
 * Umożliwia dynamiczną zmianę koloru światła, natężenia świecenia (emisji) oraz włączanie/wyłączanie.
 * Obsługuje opcję niewidoczności (pełnej przezroczystości) lub czarnego matowego profilu po wyłączeniu LED.
 * Tworzy również rzeczywiste fizyczne źródła światła (PointLight) oraz poświatę odbicia na podłodze,
 * dzięki czemu światło LED realnie oświetla fronty barów, sąsiednie moduły i odbija się od posadzki.
 */
export class LedManager {
    constructor(barBuilder, registry = null) {
        this.barBuilder = barBuilder;
        this.registry = registry;

        this.isEnabled = true;
        this.color = '#FACB7D'; // Domyślny luksusowy złoty Artbar
        this.intensity = 2.5;
        this.offAppearance = 'invisible'; // 'invisible' (przezroczysty/niewidoczny) lub 'black' (czarny profil)

        this.glowTexture = this.createGlowTexture();
        this.onLedChanged = null;
    }

    createGlowTexture() {
        if (typeof document === 'undefined') return null;
        const canvas = document.createElement('canvas');
        canvas.width = 256;
        canvas.height = 256;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        grad.addColorStop(0, 'rgba(255, 255, 255, 1)');
        grad.addColorStop(0.25, 'rgba(255, 255, 255, 0.7)');
        grad.addColorStop(0.55, 'rgba(255, 255, 255, 0.25)');
        grad.addColorStop(0.85, 'rgba(255, 255, 255, 0.05)');
        grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 256, 256);

        const tex = new THREE.CanvasTexture(canvas);
        tex.wrapS = THREE.ClampToEdgeWrapping;
        tex.wrapT = THREE.ClampToEdgeWrapping;
        return tex;
    }

    setColor(colorHex) {
        this.color = colorHex;
        this.applyToAll();
        this.notifyChanged();
    }

    setIntensity(val) {
        this.intensity = Math.max(0, Math.min(10, parseFloat(val) || 0));
        this.applyToAll();
        this.notifyChanged();
    }

    setEnabled(enabled) {
        this.isEnabled = !!enabled;
        this.applyToAll();
        this.notifyChanged();
    }

    setOffAppearance(appearance) {
        this.offAppearance = (appearance === 'black') ? 'black' : 'invisible';
        this.applyToAll();
        this.notifyChanged();
    }

    applyToAll() {
        this.barBuilder.modules.forEach(m => {
            this.applyToModule(m);
        });
    }

    applyToModule(moduleData) {
        if (!moduleData || !moduleData.mesh) return;

        const threeColor = new THREE.Color(this.color);
        const isLit = this.isEnabled && (this.intensity > 0);
        const effectiveIntensity = isLit ? this.intensity : 0;
        let hasLed = false;

        // 1. Zaktualizuj materiały i widoczność LED w siatkach modułu
        moduleData.mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                    const name = (mat.name || '').toLowerCase();
                    if (name === 'led' || name.includes('led') || child.userData.isLedMesh) {
                        child.userData.isLedMesh = true;
                        hasLed = true;

                        if (isLit) {
                            // STAN WŁĄCZONY: świecący neon w wybranym kolorze
                            child.visible = true;
                            mat.visible = true;
                            mat.transparent = false;
                            mat.opacity = 1.0;

                            if (mat.emissive) {
                                mat.emissive.copy(threeColor);
                                mat.emissiveIntensity = effectiveIntensity * 1.5;
                            }
                            if (mat.color) {
                                mat.color.copy(threeColor);
                            }
                            mat.roughness = 0.2;
                            mat.metalness = 0.0;
                        } else {
                            // STAN WYŁĄCZONY: Niewidoczność (przezroczystość) lub Czarny profil
                            if (this.offAppearance === 'invisible') {
                                child.visible = false;
                                mat.visible = false;
                                mat.transparent = true;
                                mat.opacity = 0.0;
                                if (mat.emissive) {
                                    mat.emissive.set(0x000000);
                                    mat.emissiveIntensity = 0;
                                }
                            } else {
                                // Czarny profil matowy
                                child.visible = true;
                                mat.visible = true;
                                mat.transparent = false;
                                mat.opacity = 1.0;
                                if (mat.color) {
                                    mat.color.set(0x141414);
                                }
                                if (mat.emissive) {
                                    mat.emissive.set(0x000000);
                                    mat.emissiveIntensity = 0;
                                }
                                mat.roughness = 0.85;
                                mat.metalness = 0.1;
                            }
                        }
                        mat.needsUpdate = true;
                    }
                });
            }
        });

        // Jeśli moduł nie posiada elementów LED (np. lodówka), nie montuj świateł
        if (!hasLed && !moduleData.ledRig) return;

        // 2. Zamontuj zestaw fizycznych świateł LED (PointLight) i odbić podłogowych
        this.ensureLightRig(moduleData);

        // 3. Zaktualizuj źródła światła i poświatę podłogową
        if (moduleData.ledRig) {
            const lightIntensity = isLit ? (this.intensity * 4.5) : 0;
            const glowOpacity = isLit ? Math.min(0.75, this.intensity * 0.14) : 0;

            if (moduleData.ledLights) {
                moduleData.ledLights.forEach(light => {
                    light.color.copy(threeColor);
                    light.intensity = lightIntensity;
                    light.visible = isLit;
                });
            }

            if (moduleData.ledGlowPlanes) {
                moduleData.ledGlowPlanes.forEach(plane => {
                    if (plane.material) {
                        plane.material.color.copy(threeColor);
                        plane.material.opacity = glowOpacity;
                    }
                    plane.visible = isLit;
                });
            }
        }
    }

    ensureLightRig(moduleData) {
        if (moduleData.ledRig) return;

        const rig = new THREE.Group();
        rig.name = 'LedLightRig';

        const lights = [];
        const glowPlanes = [];
        const key = moduleData.modelKey || '';

        const glowMat = new THREE.MeshBasicMaterial({
            map: this.glowTexture,
            transparent: true,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            side: THREE.DoubleSide
        });

        if (key === 'BAR_STRAIGHT') {
            // Dwa punkty świetlne PointLight wzdłuż frontowej krawędzi 1.5m baru
            // Umieszczone tuż pod listwą LED (Y=1.10, Z=0.52), oświetlające front i podłogę
            const l1 = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            l1.position.set(-0.40, 1.10, 0.52);
            rig.add(l1);
            lights.push(l1);

            const l2 = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            l2.position.set(0.40, 1.10, 0.52);
            rig.add(l2);
            lights.push(l2);

            // Miękka poświata podłogowa (ground underglow reflection)
            const glowGeom = new THREE.PlaneGeometry(1.65, 1.2);
            const glowPlane = new THREE.Mesh(glowGeom, glowMat.clone());
            glowPlane.rotation.x = -Math.PI / 2;
            glowPlane.position.set(0, 0.003, 0.70);
            rig.add(glowPlane);
            glowPlanes.push(glowPlane);

        } else if (key === 'BAR_CORNER_RIGHT' || key === 'BAR_CORNER') {
            // Narożnik prawy – oświetlenie obu ramion zakrętu 90° oraz narożnika
            const lFront = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lFront.position.set(-0.25, 1.10, 0.52);
            rig.add(lFront);
            lights.push(lFront);

            const lCorner = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lCorner.position.set(0.42, 1.10, 0.42);
            rig.add(lCorner);
            lights.push(lCorner);

            const lFlank = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lFlank.position.set(0.52, 1.10, -0.25);
            rig.add(lFlank);
            lights.push(lFlank);

            const geomCorner1 = new THREE.PlaneGeometry(1.2, 1.2);
            const p1 = new THREE.Mesh(geomCorner1, glowMat.clone());
            p1.rotation.x = -Math.PI / 2;
            p1.position.set(-0.20, 0.003, 0.70);
            rig.add(p1);
            glowPlanes.push(p1);

            const geomCorner2 = new THREE.PlaneGeometry(1.2, 1.2);
            const p2 = new THREE.Mesh(geomCorner2, glowMat.clone());
            p2.rotation.x = -Math.PI / 2;
            p2.position.set(0.70, 0.003, -0.20);
            rig.add(p2);
            glowPlanes.push(p2);

        } else if (key === 'BAR_CORNER_LEFT') {
            // Narożnik lewy (odbicie lustrzane)
            const lFront = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lFront.position.set(0.25, 1.10, 0.52);
            rig.add(lFront);
            lights.push(lFront);

            const lCorner = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lCorner.position.set(-0.42, 1.10, 0.42);
            rig.add(lCorner);
            lights.push(lCorner);

            const lFlank = new THREE.PointLight(this.color, 0, 3.8, 1.4);
            lFlank.position.set(-0.52, 1.10, -0.25);
            rig.add(lFlank);
            lights.push(lFlank);

            const geomCorner1 = new THREE.PlaneGeometry(1.2, 1.2);
            const p1 = new THREE.Mesh(geomCorner1, glowMat.clone());
            p1.rotation.x = -Math.PI / 2;
            p1.position.set(0.20, 0.003, 0.70);
            rig.add(p1);
            glowPlanes.push(p1);

            const geomCorner2 = new THREE.PlaneGeometry(1.2, 1.2);
            const p2 = new THREE.Mesh(geomCorner2, glowMat.clone());
            p2.rotation.x = -Math.PI / 2;
            p2.position.set(-0.70, 0.003, -0.20);
            rig.add(p2);
            glowPlanes.push(p2);

        } else if (key === 'BACK_SHELF') {
            // Regał zaplecza z podświetlanymi półkami
            const lTop = new THREE.PointLight(this.color, 0, 3.0, 1.6);
            lTop.position.set(0, 1.45, 0.35);
            rig.add(lTop);
            lights.push(lTop);

            const lMid = new THREE.PointLight(this.color, 0, 2.5, 1.6);
            lMid.position.set(0, 0.95, 0.35);
            rig.add(lMid);
            lights.push(lMid);

            const glowGeom = new THREE.PlaneGeometry(1.4, 1.0);
            const glowPlane = new THREE.Mesh(glowGeom, glowMat.clone());
            glowPlane.rotation.x = -Math.PI / 2;
            glowPlane.position.set(0, 0.003, 0.50);
            rig.add(glowPlane);
            glowPlanes.push(glowPlane);

        } else {
            // Generyczny fallback dla innych modułów z LED
            const lGen = new THREE.PointLight(this.color, 0, 3.0, 1.6);
            lGen.position.set(0, 1.10, 0.45);
            rig.add(lGen);
            lights.push(lGen);

            const glowGeom = new THREE.PlaneGeometry(1.2, 1.0);
            const glowPlane = new THREE.Mesh(glowGeom, glowMat.clone());
            glowPlane.rotation.x = -Math.PI / 2;
            glowPlane.position.set(0, 0.003, 0.50);
            rig.add(glowPlane);
            glowPlanes.push(glowPlane);
        }

        moduleData.mesh.add(rig);
        moduleData.ledRig = rig;
        moduleData.ledLights = lights;
        moduleData.ledGlowPlanes = glowPlanes;
    }

    getSettings() {
        return {
            enabled: this.isEnabled,
            color: this.color,
            intensity: this.intensity,
            offAppearance: this.offAppearance
        };
    }

    applySettings(settings) {
        if (!settings) return;
        if (settings.enabled !== undefined) this.isEnabled = !!settings.enabled;
        if (settings.color !== undefined) this.color = settings.color;
        if (settings.intensity !== undefined) this.intensity = settings.intensity;
        if (settings.offAppearance !== undefined) this.offAppearance = settings.offAppearance;
        this.applyToAll();
        this.notifyChanged();
    }

    notifyChanged() {
        if (typeof this.onLedChanged === 'function') {
            this.onLedChanged({
                enabled: this.isEnabled,
                color: this.color,
                intensity: this.intensity,
                offAppearance: this.offAppearance
            });
        }
    }
}
