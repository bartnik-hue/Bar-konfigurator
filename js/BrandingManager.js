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

            this.applyToAllFronts();
            if (onLoaded) onLoaded(dataUrl);
        });
    }

    applyToAllFronts() {
        const tex = this.currentTexture || (this.registry?.placeholderLogoTexture);
        if (!tex) return;

        this.barBuilder.modules.forEach(moduleData => {
            this.applyToModule(moduleData, tex);
        });
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

        moduleData.mesh.traverse(child => {
            // 1. Dedykowana płaszczyzna nakładki logo (Plane overlay)
            if (child.isMesh && child.userData.isLogoPlane) {
                child.material.map = tex;
                child.material.needsUpdate = true;
                child.visible = this.isEnabled;
            }

            // 2. Siatki frontowe oznaczone w materiale modelu GLB
            if (child.isMesh && child.userData.isBrandingFront) {
                if (!child.userData.originalMaterial) {
                    child.userData.originalMaterial = child.material;
                }
                const customMat = child.userData.originalMaterial.clone();
                customMat.map = tex;
                customMat.needsUpdate = true;
                child.material = customMat;
            }
        });
    }

    resetBranding() {
        this.currentTexture = null;
        this.currentDataUrl = null;
        if (this.registry) {
            this.registry.activeLogoTexture = null;
        }

        const defaultTex = this.registry?.placeholderLogoTexture || null;

        this.barBuilder.modules.forEach(moduleData => {
            moduleData.mesh.traverse(child => {
                if (child.isMesh && child.userData.isLogoPlane) {
                    child.material.map = defaultTex;
                    child.material.needsUpdate = true;
                    child.visible = this.isEnabled;
                }
                if (child.isMesh && child.userData.isBrandingFront && child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
            });
        });
    }
}
