import * as THREE from 'three';

/**
 * Dostępne gotowe wzory grafik panoramicznych z folderu grafiki/
 */
export const PANORAMA_PRESETS = [
    { id: 'graffitilike', name: 'Graffiti Art', file: 'grafiki/graffitilike.jpg', thumbTitle: 'Kolorowe graffiti miejskie' },
    { id: 'kamienieszlachetne', name: 'Kamienie Szlachetne', file: 'grafiki/kamienieszlachetne.jpg', thumbTitle: 'Geoda i minerały kryształowe' },
    { id: 'kwiaty2', name: 'Kwiaty Botaniczne', file: 'grafiki/kwiaty2.jpg', thumbTitle: 'Ciemna botanika florystyczna' },
    { id: 'kwiaty3', name: 'Kwiaty Egzotyczne', file: 'grafiki/kwiaty3.jpg', thumbTitle: 'Żywe egzotyczne kwiaty' },
    { id: 'palmy', name: 'Palmy Tropikalne', file: 'grafiki/palmy.jpg', thumbTitle: 'Liście palmowe i monstery' },
    { id: 'turku', name: 'Turkus & Złoto', file: 'grafiki/turku.jpg', thumbTitle: 'Marmur turkusowy ze złotymi żyłami' },
    { id: 'zloto', name: 'Złota Elegancja', file: 'grafiki/zloto.jpg', thumbTitle: 'Złocisty agat z płynnymi falami' }
];

/**
 * Zarządca personalizacji grafiki, tła panoramicznego i brandingu frontów barowych.
 */
export class BrandingManager {
    constructor(barBuilder, registry = null) {
        this.barBuilder = barBuilder;
        this.registry = registry;
        this.textureLoader = new THREE.TextureLoader();

        // ==========================================
        // 1. TŁO PANORAMICZNE (materiał 'front')
        // ==========================================
        this.isBackgroundEnabled = false;
        this.currentBackgroundUrl = null;
        this.currentBackgroundTexture = null;
        this.activePresetId = null;
        this.backgroundMode = 'chain'; // 'chain' (ciągły pas o stałej długości) | 'repeat' (każdy moduł ma całą)
        this.backgroundSpanModules = 5; // Domyślna długość grafiki: 5 barów (7.5m)
        this.defaultFrontTextures = new Map(); // id modułu -> domyślna tekstura plastiku

        // ==========================================
        // 2. LOGO / BRANDING NAKŁADKOWY (LogoPlane)
        // ==========================================
        this.isEnabled = false;
        this.currentTexture = null;
        this.currentDataUrl = null;

        const cal = registry?.calibration?.logoBarStraight || {};
        this.baseWidth = cal.width || 1.20;
        this.baseHeight = cal.height || 0.45;
        this.naturalAspect = this.baseWidth / this.baseHeight;
        this.scaleMultiplier = 1.0;
        this.offsetY = cal.offsetY !== undefined ? cal.offsetY : 0.55;
        this.lockAspect = true;

        this.onDimensionsChanged = null;
        this.onBackgroundChanged = null;
    }

    // ==========================================
    // OBSŁUGA TŁA PANORAMICZNEGO (FRONT BARU)
    // ==========================================

    /**
     * Ustawia gotowy preset tła z katalogu grafiki/
     */
    setBackgroundPreset(presetId, onLoaded = null) {
        const preset = PANORAMA_PRESETS.find(p => p.id === presetId);
        if (!preset) return;

        this.activePresetId = presetId;
        this.currentBackgroundUrl = preset.file;
        this.loadBackgroundTexture(preset.file, (texture) => {
            this.isBackgroundEnabled = true;
            this.updateFrontPanoramas();
            this.notifyBackgroundChanged();
            if (onLoaded) onLoaded(preset.file);
        });
    }

    /**
     * Wczytuje własny plik graficzny jako tło frontów
     */
    loadBackgroundFromFile(file, onLoaded = null) {
        if (!file || !file.type.startsWith('image/')) {
            console.warn('Wybrany plik nie jest obrazem.');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            this.activePresetId = null;
            this.currentBackgroundUrl = dataUrl;
            this.loadBackgroundTexture(dataUrl, (texture) => {
                this.isBackgroundEnabled = true;
                this.updateFrontPanoramas();
                this.notifyBackgroundChanged();
                if (onLoaded) onLoaded(dataUrl);
            });
        };
        reader.readAsDataURL(file);
    }

    loadBackgroundTexture(url, onReady = null) {
        this.textureLoader.load(url, (texture) => {
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.ClampToEdgeWrapping;
            texture.flipY = true;
            this.currentBackgroundTexture = texture;
            if (onReady) onReady(texture);
        });
    }

    setBackgroundSpan(modulesCount) {
        this.backgroundSpanModules = Math.max(1, Math.min(20, parseInt(modulesCount, 10) || 5));
        this.updateFrontPanoramas();
        this.notifyBackgroundChanged();
    }

    setBackgroundEnabled(enabled) {
        this.isBackgroundEnabled = !!enabled;
        this.updateFrontPanoramas();
        this.notifyBackgroundChanged();
    }

    setBackgroundMode(mode) {
        if (mode === 'chain' || mode === 'repeat') {
            this.backgroundMode = mode;
            this.updateFrontPanoramas();
            this.notifyBackgroundChanged();
        }
    }

    resetBackgroundGraphic() {
        this.isBackgroundEnabled = false;
        this.currentBackgroundUrl = null;
        this.currentBackgroundTexture = null;
        this.activePresetId = null;
        this.updateFrontPanoramas();
        this.notifyBackgroundChanged();
    }

    /**
     * Wykrywa ciągi modułów prostych stojących w jednej linii (lewy do prawego)
     */
    detectBarChains() {
        const straightBars = this.barBuilder.modules.filter(m => m.modelKey === 'BAR_STRAIGHT');
        if (straightBars.length === 0) return [];

        const barInfo = new Map();
        straightBars.forEach(m => {
            const rot = m.mesh.rotation.y;
            const pos = m.mesh.position;
            // Złącze 'left' w przestrzeni lokalnej to -0.75m X, 'right' to +0.75m X
            const leftSocket = new THREE.Vector3(-0.75, 0.5, 0)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), rot)
                .add(pos);
            const rightSocket = new THREE.Vector3(0.75, 0.5, 0)
                .applyAxisAngle(new THREE.Vector3(0, 1, 0), rot)
                .add(pos);

            barInfo.set(m.id, {
                module: m,
                leftSocket,
                rightSocket,
                leftNeighbor: null,
                rightNeighbor: null
            });
        });

        // Wykryj styki między modułami w obrębie 20 cm i o zbliżonym obrocie
        const threshold = 0.20;
        for (const [idA, infoA] of barInfo.entries()) {
            for (const [idB, infoB] of barInfo.entries()) {
                if (idA === idB) continue;
                if (infoA.rightSocket.distanceTo(infoB.leftSocket) < threshold) {
                    const diffRot = Math.abs((infoA.module.mesh.rotation.y - infoB.module.mesh.rotation.y) % (2 * Math.PI));
                    const angleOk = Math.min(diffRot, 2 * Math.PI - diffRot) < 0.25;
                    if (angleOk) {
                        infoA.rightNeighbor = infoB.module;
                        infoB.leftNeighbor = infoA.module;
                    }
                }
            }
        }

        const visited = new Set();
        const chains = [];

        // 1. Rozpocznij od głów (moduły nieposiadające sąsiada po lewej)
        for (const [id, info] of barInfo.entries()) {
            if (!info.leftNeighbor && !visited.has(info.module)) {
                const chain = [];
                let curr = info.module;
                while (curr && !visited.has(curr)) {
                    visited.add(curr);
                    chain.push(curr);
                    const currInfo = barInfo.get(curr.id);
                    curr = currInfo?.rightNeighbor || null;
                }
                if (chain.length > 0) chains.push(chain);
            }
        }

        // 2. Moduły pozostałe (np. zapętlenia lub odosobnione)
        for (const [id, info] of barInfo.entries()) {
            if (!visited.has(info.module)) {
                const chain = [];
                let curr = info.module;
                while (curr && !visited.has(curr)) {
                    visited.add(curr);
                    chain.push(curr);
                    const currInfo = barInfo.get(curr.id);
                    curr = currInfo?.rightNeighbor || null;
                }
                if (chain.length > 0) chains.push(chain);
            }
        }

        return chains;
    }

    /**
     * Główna funkcja aplikująca teksturę panoramiczną na fronty barów
     * z ciągłym mapowaniem UV wzdłuż każdego ciągu
     */
    updateFrontPanoramas() {
        const chains = this.detectBarChains();
        const sharedTex = this.currentBackgroundTexture;

        chains.forEach(chain => {
            const N = chain.length;
            chain.forEach((moduleData, k) => {
                this.applyPanoramaToModule(moduleData, sharedTex, k, N);
            });
        });

        // Zresetuj moduły, które nie są prostymi barami (jeśli kiedykolwiek otrzymały tło)
        this.barBuilder.modules.forEach(m => {
            if (m.modelKey !== 'BAR_STRAIGHT') {
                this.restoreDefaultFrontMaterial(m);
            }
        });
    }

    applyPanoramaToModule(moduleData, sharedTex, indexInChain = 0, chainLength = 1) {
        if (!moduleData || !moduleData.mesh) return;

        moduleData.mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                    if (mat && (mat.name === 'front' || child.userData.isFrontPanel)) {
                        // Zapisz oryginalną fabryczną teksturę
                        if (!this.defaultFrontTextures.has(moduleData.id) && mat.map) {
                            this.defaultFrontTextures.set(moduleData.id, mat.map);
                        }

                        if (this.isBackgroundEnabled && sharedTex) {
                            // Sklonuj teksturę dla tego konkretnego modułu, aby nadać unikalny repeat i offset
                            const texClone = sharedTex.clone();
                            texClone.wrapS = THREE.RepeatWrapping;
                            texClone.wrapT = THREE.ClampToEdgeWrapping;

                            const span = this.backgroundSpanModules || 5;
                            if (this.backgroundMode === 'chain') {
                                // Grafika o stałej długości (np. 5 barów):
                                // Każdy bar ma stałą 1/span szerokości wzoru (brak rozciągania/ściskania)
                                // a po przekroczeniu pełnej długości (5 barów) płynnie się powtarza
                                texClone.repeat.set(1 / span, 1);
                                texClone.offset.set((indexInChain / span) % 1, 0);
                            } else {
                                texClone.repeat.set(1, 1);
                                texClone.offset.set(0, 0);
                            }
                            texClone.needsUpdate = true;
                            mat.map = texClone;
                            mat.needsUpdate = true;
                        } else {
                            // Przywróć fabryczną teksturę
                            const defTex = this.defaultFrontTextures.get(moduleData.id) || null;
                            mat.map = defTex;
                            mat.needsUpdate = true;
                        }
                    }
                });
            }
        });
    }

    restoreDefaultFrontMaterial(moduleData) {
        if (!moduleData || !moduleData.mesh) return;
        moduleData.mesh.traverse(child => {
            if (child.isMesh && child.material) {
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                mats.forEach(mat => {
                    if (mat && (mat.name === 'front' || child.userData.isFrontPanel)) {
                        const defTex = this.defaultFrontTextures.get(moduleData.id) || null;
                        mat.map = defTex;
                        mat.needsUpdate = true;
                    }
                });
            }
        });
    }

    notifyBackgroundChanged() {
        if (typeof this.onBackgroundChanged === 'function') {
            this.onBackgroundChanged({
                enabled: this.isBackgroundEnabled,
                url: this.currentBackgroundUrl,
                presetId: this.activePresetId,
                mode: this.backgroundMode,
                spanModules: this.backgroundSpanModules
            });
        }
    }

    // ==========================================
    // OBSŁUGA LOGO / BRANDING NAKŁADKOWY
    // ==========================================

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
        const maxW = 1.20;
        const maxH = 0.50;
        if (this.naturalAspect >= (maxW / maxH)) {
            this.baseWidth = maxW;
            this.baseHeight = maxW / this.naturalAspect;
        } else {
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
            background: {
                enabled: this.isBackgroundEnabled,
                url: this.currentBackgroundUrl,
                presetId: this.activePresetId,
                mode: this.backgroundMode,
                spanModules: this.backgroundSpanModules
            },
            logo: {
                baseWidth: this.baseWidth,
                baseHeight: this.baseHeight,
                scaleMultiplier: this.scaleMultiplier,
                offsetY: this.offsetY,
                lockAspect: this.lockAspect,
                naturalAspect: this.naturalAspect,
                enabled: this.isEnabled
            }
        };
    }

    applySettings(settings) {
        if (!settings) return;

        // Tło panoramiczne
        if (settings.background) {
            const bg = settings.background;
            this.backgroundMode = bg.mode || 'chain';
            this.activePresetId = bg.presetId || null;
            if (bg.spanModules !== undefined) this.backgroundSpanModules = bg.spanModules;
            if (bg.url) {
                this.currentBackgroundUrl = bg.url;
                this.loadBackgroundTexture(bg.url, (tex) => {
                    this.isBackgroundEnabled = !!bg.enabled;
                    this.updateFrontPanoramas();
                    this.notifyBackgroundChanged();
                });
            } else {
                this.resetBackgroundGraphic();
            }
        }

        // Logo
        const logo = settings.logo || settings; // kompatybilność ze starszą strukturą
        if (logo.baseWidth !== undefined) this.baseWidth = logo.baseWidth;
        if (logo.baseHeight !== undefined) this.baseHeight = logo.baseHeight;
        if (logo.scaleMultiplier !== undefined) this.scaleMultiplier = logo.scaleMultiplier;
        if (logo.offsetY !== undefined) this.offsetY = logo.offsetY;
        if (logo.lockAspect !== undefined) this.lockAspect = logo.lockAspect;
        if (logo.naturalAspect !== undefined) this.naturalAspect = logo.naturalAspect;
        if (logo.enabled !== undefined) this.setEnabled(logo.enabled);

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
