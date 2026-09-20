import * as THREE from 'three';

/**
 * Zarządca personalizacji grafiki i brandingu frontów barowych.
 */
export class BrandingManager {
    constructor(barBuilder, registry = null) {
        this.barBuilder = barBuilder;
        this.registry = registry;
        this.isEnabled = false;
        this.currentTexture = null;
        this.currentDataUrl = null;
        this.textureLoader = new THREE.TextureLoader();

        // Parametry wymiarów i proporcji
        const cal = registry?.calibration?.logoBarStraight || {};
        this.baseWidth = cal.width || 1.20;
        this.baseHeight = cal.height || 0.45;
        this.naturalAspect = this.baseWidth / this.baseHeight;
        this.scaleMultiplier = 1.0;
        this.offsetY = cal.offsetY !== undefined ? cal.offsetY : 0.55;
        this.lockAspect = true;

        this.onDimensionsChanged = null;
    }

    loadGraphicFromFile(file, onLoaded) {
        if (!file || !file.type.startsWith('image/')) {
            console.warn('Wybrany plik nie jest obrazem.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            this.loadGraphicFromDataUrl(e.target.result, onLoaded);
        };
        reader.readAsDataURL(file);
    }

    loadGraphicFromDataUrl(dataUrl, onLoaded) {
        if (!dataUrl) return;
        this.currentDataUrl = dataUrl;

        this.textureLoader.load(dataUrl, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.ClampToEdgeWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.flipY = true;
            this.currentTexture = texture;
            if (this.registry) {
                this.registry.activeLogoTexture = texture;
            }

            // Oblicz naturalne proporcje wczytanego obrazu i dopasuj
            const img = texture.image;
            const imgW = img?.naturalWidth || img?.width || 1200;
            const imgH = img?.naturalHeight || img?.height || 450;
            if (imgW && imgH) {
                this.naturalAspect = imgW / imgH;
                this.autoFitAspect();
            }

            this.applyToAllFronts();
            this.notifyDimensionsChanged();
            if (onLoaded) onLoaded(dataUrl);
        });
    }

    autoFitAspect() {
        // Dopasuj do optymalnego obszaru frontu modułu 1.5m (max szer 1.20m, max wys 0.50m)
        const maxW = 1.20;
        const maxH = 0.50;
        if (this.naturalAspect >= (maxW / maxH)) {
            // Szerokie logo (ograniczone szerokością)
            this.baseWidth = maxW;
            this.baseHeight = maxW / this.naturalAspect;
        } else {
            // Wąskie lub kwadratowe/pionowe logo (ograniczone wysokością)
            this.baseHeight = maxH;
            this.baseWidth = maxH * this.naturalAspect;
        }
        this.baseWidth = Math.round(this.baseWidth * 1000) / 1000;
        this.baseHeight = Math.round(this.baseHeight * 1000) / 1000;
        this.scaleMultiplier = 1.0;
        this.updateLogoPlanes();
    }

    getEffectiveWidth() {
        return Math.round(this.baseWidth * this.scaleMultiplier * 1000) / 1000;
    }

    getEffectiveHeight() {
        return Math.round(this.baseHeight * this.scaleMultiplier * 1000) / 1000;
    }

    setScale(scalePercent) {
        this.scaleMultiplier = Math.max(0.1, scalePercent / 100);
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();
    }

    setWidth(width) {
        const w = Math.max(0.15, Math.min(1.45, width));
        if (this.lockAspect && this.naturalAspect) {
            const h = Math.max(0.08, Math.min(0.75, w / this.naturalAspect));
            this.baseWidth = w / this.scaleMultiplier;
            this.baseHeight = h / this.scaleMultiplier;
        } else {
            this.baseWidth = w / this.scaleMultiplier;
        }
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();
    }

    setHeight(height) {
        const h = Math.max(0.08, Math.min(0.75, height));
        if (this.lockAspect && this.naturalAspect) {
            const w = Math.max(0.15, Math.min(1.45, h * this.naturalAspect));
            this.baseWidth = w / this.scaleMultiplier;
            this.baseHeight = h / this.scaleMultiplier;
        } else {
            this.baseHeight = h / this.scaleMultiplier;
        }
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();
    }

    setOffsetY(offsetY) {
        this.offsetY = Math.max(0.20, Math.min(0.85, offsetY));
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();
    }

    setLockAspect(locked) {
        this.lockAspect = !!locked;
        if (this.lockAspect) {
            // Zsynchronizuj naturalAspect z bieżącymi proporcjami
            const effW = this.getEffectiveWidth();
            const effH = this.getEffectiveHeight();
            if (effH > 0) {
                this.naturalAspect = effW / effH;
            }
        }
    }

    resetAspect() {
        if (this.currentTexture?.image) {
            const img = this.currentTexture.image;
            const imgW = img.naturalWidth || img.width || 1200;
            const imgH = img.naturalHeight || img.height || 450;
            this.naturalAspect = imgW / imgH;
        } else {
            this.naturalAspect = 1.20 / 0.45;
        }
        this.autoFitAspect();
        this.notifyDimensionsChanged();
    }

    updateLogoPlanes() {
        const effectiveW = this.getEffectiveWidth();
        const effectiveH = this.getEffectiveHeight();

        if (this.registry?.calibration?.logoBarStraight) {
            this.registry.calibration.logoBarStraight.width = effectiveW;
            this.registry.calibration.logoBarStraight.height = effectiveH;
            this.registry.calibration.logoBarStraight.offsetY = this.offsetY;
            this.registry.saveCalibration();
        }

        this.barBuilder.modules.forEach(moduleData => {
            moduleData.mesh.traverse(child => {
                if (child.isMesh && child.userData.isLogoPlane) {
                    child.position.y = this.offsetY;
                    if (child.geometry) {
                        child.geometry.dispose();
                        child.geometry = new THREE.PlaneGeometry(effectiveW, effectiveH);
                    }
                }
            });
        });
    }

    notifyDimensionsChanged() {
        if (typeof this.onDimensionsChanged === 'function') {
            this.onDimensionsChanged({
                scale: Math.round(this.scaleMultiplier * 100),
                width: this.getEffectiveWidth(),
                height: this.getEffectiveHeight(),
                offsetY: Math.round(this.offsetY * 100) / 100,
                lockAspect: this.lockAspect
            });
        }
    }

    applyToAllFronts() {
        const tex = this.currentTexture || (this.registry?.placeholderLogoTexture);
        if (!tex) return;

        this.barBuilder.modules.forEach(moduleData => {
            this.applyToModule(moduleData, tex);
        });
    }

    setEnabled(enabled) {
        this.isEnabled = !!enabled;
        if (this.registry) {
            this.registry.isLogoEnabled = this.isEnabled;
        }
        this.barBuilder.modules.forEach(moduleData => {
            moduleData.mesh.traverse(child => {
                if (child.isMesh && child.userData.isLogoPlane) {
                    child.visible = this.isEnabled;
                }
            });
        });
    }

    applyToModule(moduleData, texture) {
        const tex = texture || this.currentTexture || (this.registry?.placeholderLogoTexture);
        if (!tex) return;

        const effectiveW = this.getEffectiveWidth();
        const effectiveH = this.getEffectiveHeight();

        moduleData.mesh.traverse(child => {
            if (child.isMesh && child.userData.isLogoPlane) {
                child.material.map = tex;
                child.material.needsUpdate = true;
                child.visible = this.isEnabled;
                child.position.y = this.offsetY;
                if (child.geometry) {
                    child.geometry.dispose();
                    child.geometry = new THREE.PlaneGeometry(effectiveW, effectiveH);
                }
            }
        });
    }

    getSettings() {
        return {
            baseWidth: this.baseWidth,
            baseHeight: this.baseHeight,
            scaleMultiplier: this.scaleMultiplier,
            offsetY: this.offsetY,
            lockAspect: this.lockAspect,
            naturalAspect: this.naturalAspect
        };
    }

    applySettings(settings) {
        if (!settings) return;
        if (settings.baseWidth !== undefined) this.baseWidth = settings.baseWidth;
        if (settings.baseHeight !== undefined) this.baseHeight = settings.baseHeight;
        if (settings.scaleMultiplier !== undefined) this.scaleMultiplier = settings.scaleMultiplier;
        if (settings.offsetY !== undefined) this.offsetY = settings.offsetY;
        if (settings.lockAspect !== undefined) this.lockAspect = settings.lockAspect;
        if (settings.naturalAspect !== undefined) this.naturalAspect = settings.naturalAspect;
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();
    }

    resetBranding() {
        this.currentTexture = null;
        this.currentDataUrl = null;
        if (this.registry) {
            this.registry.activeLogoTexture = null;
        }

        const defaultTex = this.registry?.placeholderLogoTexture || null;
        this.baseWidth = 1.20;
        this.baseHeight = 0.45;
        this.naturalAspect = 1.20 / 0.45;
        this.scaleMultiplier = 1.0;
        this.offsetY = 0.55;
        this.updateLogoPlanes();
        this.notifyDimensionsChanged();

        this.barBuilder.modules.forEach(moduleData => {
            moduleData.mesh.traverse(child => {
                if (child.isMesh && child.userData.isLogoPlane) {
                    child.material.map = defaultTex;
                    child.material.needsUpdate = true;
                    child.visible = this.isEnabled;
                }
            });
        });
    }
}
