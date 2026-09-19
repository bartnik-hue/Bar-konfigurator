import * as THREE from 'three';

export class BarBuilder {
    constructor(scene, camera, renderer, registry, onSceneChanged) {
        this.scene = scene;
        this.camera = camera;
        this.renderer = renderer;
        this.registry = registry;
        this.onSceneChanged = onSceneChanged;

        this.modules = [];
        this.selectedModule = null;
        this.socketHandles = []; // Kropki połączeniowe 3D

        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Podgląd pod myszką (Ghost Preview)
        this.ghostModule = null;
        this.ghostModelKey = null;
        this.ghostRotation = 0;
        this.ghostSnapContext = null;

        // Materiał kropki połączeniowej (złota świecąca kropka w stylu Artbar)
        this.socketGeom = new THREE.SphereGeometry(0.14, 16, 16);
        this.socketMat = new THREE.MeshBasicMaterial({
            color: 0xFACB7D,
            transparent: true,
            opacity: 0.95
        });

        // Wskaźnik selekcji (złota ramka pod modułem)
        this.selectionRing = this.createSelectionRing();
        this.scene.add(this.selectionRing);
        this.selectionRing.visible = false;
    }

    createSelectionRing() {
        const ringGeom = new THREE.RingGeometry(0.85, 0.92, 32);
        ringGeom.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0xFACB7D,
            side: THREE.DoubleSide
        });
        const ring = new THREE.Mesh(ringGeom, ringMat);
        ring.position.y = 0.02;
        return ring;
    }

    /**
     * Zwraca liczbę poszczególnych elementów w scenie
     */
    getStats() {
        const counts = {
            BAR_STRAIGHT: 0,
            BAR_CORNER: 0,
            BAR_CORNER_RIGHT: 0,
            BAR_CORNER_LEFT: 0,
            BACK_SHELF: 0,
            BACK_FRIDGE: 0,
            totalFrontMeters: 0
        };

        this.modules.forEach(m => {
            if (m.modelKey === 'BAR_STRAIGHT') {
                counts.BAR_STRAIGHT++;
                counts.totalFrontMeters += 1.5;
            } else if (m.modelKey === 'BAR_CORNER_RIGHT' || m.modelKey === 'BAR_CORNER') {
                counts.BAR_CORNER_RIGHT++;
                counts.BAR_CORNER++;
                counts.totalFrontMeters += 0.95;
            } else if (m.modelKey === 'BAR_CORNER_LEFT') {
                counts.BAR_CORNER_LEFT++;
                counts.BAR_CORNER++;
                counts.totalFrontMeters += 0.95;
            } else if (m.modelKey === 'BACK_SHELF') {
                counts.BACK_SHELF++;
            } else if (m.modelKey === 'BACK_FRIDGE') {
                counts.BACK_FRIDGE++;
            }
        });

        return counts;
    }

    notifyChange() {
        if (this.onSceneChanged) {
            this.onSceneChanged(this.getStats());
        }
    }

    clearScene() {
        this.deselectModule();
        this.cancelGhost();

        this.modules.forEach(m => {
            this.scene.remove(m.mesh);
        });
        this.modules = [];
        this.notifyChange();
    }

    /**
     * Eksportuje stan układu wraz z bitmapą do obiektu JSON
     */
    exportProject(brandingDataUrl = null) {
        return {
            app: 'ArtbarConfigurator',
            version: '1.0',
            savedAt: new Date().toISOString(),
            brandingDataUrl: brandingDataUrl,
            modules: this.modules.map(m => ({
                id: m.id,
                modelKey: m.modelKey,
                position: {
                    x: Number(m.mesh.position.x.toFixed(4)),
                    y: Number(m.mesh.position.y.toFixed(4)),
                    z: Number(m.mesh.position.z.toFixed(4))
                },
                rotationY: Number(m.rotationY.toFixed(4))
            }))
        };
    }

    /**
     * Wczytuje układ z obiektu JSON
     */
    importProject(projectData) {
        if (!projectData || !Array.isArray(projectData.modules)) {
            throw new Error('Niepoprawny format pliku konfiguracji Artbar.');
        }

        this.clearScene();

        projectData.modules.forEach(item => {
            const pos = new THREE.Vector3(item.position.x, item.position.y, item.position.z);
            this.addModule(item.modelKey, pos, item.rotationY);
        });

        this.notifyChange();
        return projectData.brandingDataUrl;
    }

    /**
     * Stawia moduł w konkretnym punkcie i o zadanym kącie
     */
    addModule(modelKey, position = new THREE.Vector3(), rotationY = 0) {
        const mesh = this.registry.instantiate(modelKey);
        if (!mesh) return null;

        mesh.position.copy(position);
        mesh.rotation.y = rotationY;
        this.scene.add(mesh);

        const moduleData = {
            id: 'mod_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
            modelKey: modelKey,
            mesh: mesh,
            position: mesh.position,
            rotationY: rotationY
        };

        this.modules.push(moduleData);
        this.notifyChange();
        return moduleData;
    }

    removeModule(moduleData) {
        if (!moduleData) return;
        if (this.selectedModule === moduleData) {
            this.deselectModule();
        }

        const idx = this.modules.indexOf(moduleData);
        if (idx !== -1) {
            this.scene.remove(moduleData.mesh);
            this.modules.splice(idx, 1);
            this.notifyChange();
        }
    }

    removeSelected() {
        if (this.selectedModule) {
            this.removeModule(this.selectedModule);
        }
    }

    rotateSelected(deltaAngle = Math.PI / 2) {
        if (!this.selectedModule) return;
        this.selectedModule.rotationY += deltaAngle;
        this.selectedModule.mesh.rotation.y = this.selectedModule.rotationY;
        this.updateSocketHandles();
        this.notifyChange();
    }

    selectModule(moduleData) {
        this.deselectModule();
        this.selectedModule = moduleData;

        // Pokaż wskaźnik zaznaczenia
        this.selectionRing.position.set(moduleData.mesh.position.x, 0.02, moduleData.mesh.position.z);
        this.selectionRing.visible = true;

        // Wygeneruj kropki połączeń (Socket Handles)
        this.generateSocketHandles(moduleData);
    }

    deselectModule() {
        this.selectedModule = null;
        this.selectionRing.visible = false;
        this.clearSocketHandles();
    }

    clearSocketHandles() {
        this.socketHandles.forEach(h => this.scene.remove(h));
        this.socketHandles = [];
    }

    /**
     * Tworzy klikalne kropki na końcach zaznaczonego modułu
     */
    generateSocketHandles(moduleData) {
        this.clearSocketHandles();
        const defs = this.registry.getSocketDefinitions(moduleData.modelKey);

        defs.forEach(socketDef => {
            // Oblicz pozycję kropki w przestrzeni świata
            const worldPos = socketDef.position.clone();
            worldPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), moduleData.mesh.rotation.y);
            worldPos.add(moduleData.mesh.position);

            // Oblicz wektor kierunku w przestrzeni świata
            const worldDir = socketDef.direction.clone();
            worldDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), moduleData.mesh.rotation.y);

            // Sprawdź czy dane gniazdo nie jest już zajęte przez inny moduł
            if (this.isSocketOccupied(worldPos, moduleData)) {
                return;
            }

            // Tworzymy widoczną kulkę z zewnętrznym pierścieniem poświaty
            const handleGroup = new THREE.Group();
            handleGroup.position.copy(worldPos);

            const sphere = new THREE.Mesh(this.socketGeom, this.socketMat);
            handleGroup.add(sphere);

            // Niewidzialna większa sfera trafienia (ułatwia kliknięcie myszą)
            const hitGeom = new THREE.SphereGeometry(0.35, 8, 8);
            const hitMat = new THREE.MeshBasicMaterial({ visible: false });
            const hitSphere = new THREE.Mesh(hitGeom, hitMat);
            handleGroup.add(hitSphere);

            // Pierścień poświaty wokół kropki
            const glowRingGeom = new THREE.RingGeometry(0.18, 0.23, 24);
            glowRingGeom.rotateX(-Math.PI / 2);
            const glowMat = new THREE.MeshBasicMaterial({
                color: 0xFACB7D,
                side: THREE.DoubleSide,
                transparent: true,
                opacity: 0.6
            });
            const glow = new THREE.Mesh(glowRingGeom, glowMat);
            handleGroup.add(glow);

            handleGroup.userData = {
                isSocketHandle: true,
                parentModule: moduleData,
                socketDef: socketDef,
                worldPos: worldPos,
                worldDir: worldDir
            };

            this.scene.add(handleGroup);
            this.socketHandles.push(handleGroup);
        });
    }

    isSocketOccupied(worldPos, currentModule) {
        const threshold = 0.35; // promień wykrywania zajętości
        for (const m of this.modules) {
            if (m === currentModule) continue;
            // Sprawdź odległość środka modułu lub jego gniazd
            if (m.mesh.position.distanceTo(worldPos) < threshold) {
                return true;
            }
            const otherDefs = this.registry.getSocketDefinitions(m.modelKey);
            for (const oDef of otherDefs) {
                const oWorldPos = oDef.position.clone();
                oWorldPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), m.mesh.rotation.y);
                oWorldPos.add(m.mesh.position);
                if (oWorldPos.distanceTo(worldPos) < threshold) {
                    return true;
                }
            }
        }
        return false;
    }

    /**
     * Oblicza docelową pozycję i kąt obrotu modułu dołączanego do danego gniazda
     */
    computeSocketAttachment(parentModule, socketDef, newModelKey) {
        const parentPos = parentModule.mesh.position;
        const parentRot = parentModule.mesh.rotation.y;

        // Wymiary z kalibracji
        const parentCal = this.registry.getCalibrationFor(parentModule.modelKey) || { width: 1.5 };
        const newCal = this.registry.getCalibrationFor(newModelKey) || { width: 1.5 };

        const parentWidth = parentCal.width || 1.5;
        const newWidth = newCal.width || 1.5;
        const offset = (parentWidth / 2) + (newWidth / 2);

        let targetRot = parentRot;
        const targetPos = new THREE.Vector3();

        if (parentModule.modelKey === 'BAR_STRAIGHT') {
            if (socketDef.id === 'right') {
                const shift = new THREE.Vector3(offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);
                targetRot = parentRot;
            } else if (socketDef.id === 'left') {
                const shift = new THREE.Vector3(-offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);
                targetRot = parentRot;
            }
        } else if (parentModule.modelKey === 'BAR_CORNER_RIGHT' || parentModule.modelKey === 'BAR_CORNER') {
            if (socketDef.id === 'out') {
                targetRot = parentRot + Math.PI / 2;
                const shift = new THREE.Vector3(0, 0, -offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);

                const outCal = this.registry.getCalibrationFor('barCornerRightOut');
                if (outCal && (outCal.offsetX !== 0 || outCal.offsetY !== 0 || outCal.offsetZ !== 0)) {
                    const fineShift = new THREE.Vector3(outCal.offsetX || 0, outCal.offsetY || 0, outCal.offsetZ || 0)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
                    targetPos.add(fineShift);
                }
            } else {
                const shift = new THREE.Vector3(-offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);
                targetRot = parentRot;
            }
        } else if (parentModule.modelKey === 'BAR_CORNER_LEFT') {
            if (socketDef.id === 'out') {
                targetRot = parentRot - Math.PI / 2;
                const shift = new THREE.Vector3(0, 0, -offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);

                const outCal = this.registry.getCalibrationFor('barCornerLeftOut');
                if (outCal && (outCal.offsetX !== 0 || outCal.offsetY !== 0 || outCal.offsetZ !== 0)) {
                    const fineShift = new THREE.Vector3(outCal.offsetX || 0, outCal.offsetY || 0, outCal.offsetZ || 0)
                        .applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);
                    targetPos.add(fineShift);
                }
            } else {
                const shift = new THREE.Vector3(offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                targetPos.copy(parentPos).add(shift);
                targetRot = parentRot;
            }
        } else {
            const sign = (socketDef.id === 'right') ? 1 : -1;
            const shift = new THREE.Vector3(sign * offset, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
            targetPos.copy(parentPos).add(shift);
            targetRot = parentRot;
        }

        return { targetPos, targetRot };
    }

    /**
     * Dołącza nowy moduł do wybranego gniazda (kropki)
     */
    attachModuleToSocket(parentModule, socketDef, newModelKey) {
        const { targetPos, targetRot } = this.computeSocketAttachment(parentModule, socketDef, newModelKey);

        const newModule = this.addModule(newModelKey, targetPos, targetRot);
        if (newModule) {
            newModule.attachedTo = {
                parentModuleId: parentModule.id,
                parentModelKey: parentModule.modelKey,
                socketId: socketDef.id
            };
            this.selectModule(newModule);
        }
        return newModule;
    }

    /**
     * Wyszukuje najbliższe kompatybilne i wolne gniazdo do przyciągnięcia (Magnetic Snap)
     */
    findBestSocketSnap(cursorPoint, modelKey) {
        if (!cursorPoint || !modelKey) return null;

        let bestSnap = null;
        let minDistance = 1.10; // Promień przyciągania: 1.1m

        for (const m of this.modules) {
            const defs = this.registry.getSocketDefinitions(m.modelKey);
            for (const socketDef of defs) {
                // Czy dany model może być podłączony do tego gniazda?
                if (!socketDef.compatible || !socketDef.compatible.includes(modelKey)) {
                    continue;
                }

                // Pozycja gniazda w świecie
                const socketWorldPos = socketDef.position.clone();
                socketWorldPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), m.mesh.rotation.y);
                socketWorldPos.add(m.mesh.position);

                // Sprawdź czy gniazdo nie jest już zajęte
                if (this.isSocketOccupied(socketWorldPos, m)) {
                    continue;
                }

                // Oblicz docelową pozycję modułu
                const { targetPos, targetRot } = this.computeSocketAttachment(m, socketDef, modelKey);

                // Sprawdź odległość kursora od gniazda lub od docelowej pozycji modułu
                const distToSocket = cursorPoint.distanceTo(socketWorldPos);
                const distToTarget = cursorPoint.distanceTo(targetPos);
                const effectiveDist = Math.min(distToSocket, distToTarget);

                if (effectiveDist < minDistance) {
                    minDistance = effectiveDist;
                    bestSnap = {
                        parentModule: m,
                        socketDef: socketDef,
                        targetPos: targetPos,
                        targetRot: targetRot,
                        socketWorldPos: socketWorldPos,
                        distance: effectiveDist
                    };
                }
            }
        }

        return bestSnap;
    }

    /**
     * Tryb stawiania pod kursorem (Ghost Mode)
     */
    startGhost(modelKey) {
        this.cancelGhost();
        this.deselectModule();

        this.ghostModelKey = modelKey;
        this.ghostRotation = 0;
        this.ghostSnapContext = null;

        const mesh = this.registry.instantiate(modelKey);
        if (!mesh) return;

        // Ustaw półprzezroczysty materiał podglądu (ghost)
        mesh.traverse(child => {
            if (child.isMesh) {
                child.material = child.material.clone();
                child.material.transparent = true;
                child.material.opacity = 0.55;
                child.material.depthWrite = false;
            }
        });

        this.ghostModule = mesh;
        this.scene.add(this.ghostModule);
    }

    updateGhost(intersectPoint) {
        if (!this.ghostModule || !intersectPoint) return;

        // Sprawdź czy w pobliżu kursora znajduje się pasujące gniazdo do przyciągnięcia
        const snapCandidate = this.findBestSocketSnap(intersectPoint, this.ghostModelKey);

        if (snapCandidate) {
            this.ghostSnapContext = snapCandidate;
            this.ghostModule.position.copy(snapCandidate.targetPos);
            this.ghostModule.rotation.y = snapCandidate.targetRot;
            this.setGhostVisualSnap(true);
        } else {
            this.ghostSnapContext = null;
            // Swobodne pozycjonowanie na siatce 0.25m
            const snap = 0.25;
            const snappedX = Math.round(intersectPoint.x / snap) * snap;
            const snappedZ = Math.round(intersectPoint.z / snap) * snap;

            this.ghostModule.position.set(snappedX, 0, snappedZ);
            this.ghostModule.rotation.y = this.ghostRotation;
            this.setGhostVisualSnap(false);
        }
    }

    setGhostVisualSnap(isSnapped) {
        if (!this.ghostModule) return;
        this.ghostModule.traverse(child => {
            if (child.isMesh && child.material) {
                child.material.opacity = isSnapped ? 0.85 : 0.55;
            }
        });
    }

    rotateGhost(delta = Math.PI / 2) {
        this.ghostRotation += delta;
        if (!this.ghostSnapContext && this.ghostModule) {
            this.ghostModule.rotation.y = this.ghostRotation;
        }
    }

    commitGhost() {
        if (!this.ghostModule || !this.ghostModelKey) return null;

        let mod = null;
        if (this.ghostSnapContext) {
            // Dołącz do przyciągniętego gniazda z pełnymi metadanymi i offsetem
            const { parentModule, socketDef } = this.ghostSnapContext;
            mod = this.attachModuleToSocket(parentModule, socketDef, this.ghostModelKey);
        } else {
            // Postaw swobodnie na podłodze
            const pos = this.ghostModule.position.clone();
            const rot = this.ghostRotation;
            const key = this.ghostModelKey;
            mod = this.addModule(key, pos, rot);
            if (mod) this.selectModule(mod);
        }

        this.cancelGhost();
        return mod;
    }

    placeGhost() {
        return this.commitGhost();
    }

    cancelGhost() {
        if (this.ghostModule) {
            this.scene.remove(this.ghostModule);
            this.ghostModule = null;
            this.ghostModelKey = null;
            this.ghostSnapContext = null;
        }
    }

    /**
     * Animacja pulsowania kropek połączeń
     */
    update(delta) {
        const time = performance.now() * 0.003;
        const scale = 1.0 + Math.sin(time) * 0.12;

        this.socketHandles.forEach(h => {
            const sphere = h.children[0];
            if (sphere) sphere.scale.set(scale, scale, scale);
        });

        if (this.selectionRing.visible) {
            const ringScale = 1.0 + Math.sin(time * 1.5) * 0.03;
            this.selectionRing.scale.set(ringScale, ringScale, ringScale);
        }
    }

    // ==========================================
    // PRESETY UKŁADÓW BARU
    // ==========================================

    loadPreset(presetName) {
        this.clearScene();

        switch (presetName) {
            case 'straight':
                this.buildPresetStraight();
                break;
            case 'l_shape':
                this.buildPresetLShape();
                break;
            case 'horseshoe':
                this.buildPresetHorseshoe();
                break;
            case 'island':
                this.buildPresetIsland();
                break;
            default:
                console.warn('Nieznany preset:', presetName);
        }
    }

    buildPresetStraight() {
        // 4 moduły baru w linii
        const startX = -2.25;
        for (let i = 0; i < 4; i++) {
            this.addModule('BAR_STRAIGHT', new THREE.Vector3(startX + i * 1.5, 0, 0), 0);
        }

        // Linia zaplecza za barem (odległość korytarza 1.25m): 2 regały i 2 lodówki
        const backZ = -1.35;
        this.addModule('BACK_SHELF', new THREE.Vector3(-1.75, 0, backZ), 0);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(-0.50, 0, backZ), 0);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(0.50, 0, backZ), 0);
        this.addModule('BACK_SHELF', new THREE.Vector3(1.75, 0, backZ), 0);
    }

    buildPresetLShape() {
        // Render: L 0001.png
        // Ramię 1: 3 moduły w linii
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-2.25, 0, 0), 0);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-0.75, 0, 0), 0);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(0.75, 0, 0), 0);

        // Narożnik łączący (Róg Prawy)
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(1.975, 0, 0), 0);

        // Ramię 2 (w głąb / w osi -Z): 3 moduły z idealnym spasowaniem
        const arm2X = 1.975;
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(arm2X, 0, -1.225), Math.PI / 2);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(arm2X, 0, -2.725), Math.PI / 2);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(arm2X, 0, -4.225), Math.PI / 2);

        // Zaplecze L: regały i lodówki
        this.addModule('BACK_SHELF', new THREE.Vector3(-1.5, 0, -1.35), 0);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(-0.25, 0, -1.35), 0);
        this.addModule('BACK_SHELF', new THREE.Vector3(0.65, 0, -2.2), Math.PI / 2);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(0.65, 0, -3.45), Math.PI / 2);
    }

    buildPresetHorseshoe() {
        // Render: podkowa 0001.png (Kształt U z lustrzanymi rogami)
        // Front centralny: 2 moduły
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-0.75, 0, 0), 0);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(0.75, 0, 0), 0);

        // Ramię prawe: róg prawy + 2 moduły w głąb
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(1.975, 0, 0), 0);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(1.975, 0, -1.225), Math.PI / 2);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(1.975, 0, -2.725), Math.PI / 2);

        // Ramię lewe: róg lewy + 2 moduły w głąb
        this.addModule('BAR_CORNER_LEFT', new THREE.Vector3(-1.975, 0, 0), 0);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-1.975, 0, -1.225), -Math.PI / 2);
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-1.975, 0, -2.725), -Math.PI / 2);

        // Centralny rdzeń zaplecza
        this.addModule('BACK_SHELF', new THREE.Vector3(-0.75, 0, -1.5), 0);
        this.addModule('BACK_SHELF', new THREE.Vector3(0.75, 0, -1.5), 0);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(-0.50, 0, -2.5), Math.PI);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(0.50, 0, -2.5), Math.PI);
    }

    buildPresetIsland() {
        // Render: kwadrat bg0001.png (Wyspa 360 stopni - idealnie zamknięty obwód 0.000mm)
        const D = 1.225;

        // Bok 1 (północny - front)
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(0, 0, D), 0);
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(D, 0, D), 0);

        // Bok 2 (wschodni - bok prawy)
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(D, 0, 0), Math.PI / 2);
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(D, 0, -D), Math.PI / 2);

        // Bok 3 (południowy - tył)
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(0, 0, -D), Math.PI);
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(-D, 0, -D), Math.PI);

        // Bok 4 (zachodni - bok lewy)
        this.addModule('BAR_STRAIGHT', new THREE.Vector3(-D, 0, 0), -Math.PI / 2);
        this.addModule('BAR_CORNER_RIGHT', new THREE.Vector3(-D, 0, D), -Math.PI / 2);

        // Centrum: 2 regały i 2 lodówki tworzące wyspę techniczną
        this.addModule('BACK_SHELF', new THREE.Vector3(0, 0, 0.4), 0);
        this.addModule('BACK_SHELF', new THREE.Vector3(0, 0, -0.4), Math.PI);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(-0.4, 0, 0), -Math.PI / 2);
        this.addModule('BACK_FRIDGE', new THREE.Vector3(0.4, 0, 0), Math.PI / 2);
    }
}
