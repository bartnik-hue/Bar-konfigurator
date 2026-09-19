import * as THREE from 'three';

/**
 * Zarządca personalizacji grafiki i brandingu frontów barowych.
 */
export class BrandingManager {
    constructor(barBuilder) {
        this.barBuilder = barBuilder;
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
            texture.flipY = false; // Zgodnie z glTF convention
            this.currentTexture = texture;

            this.applyToAllFronts();
            if (onLoaded) onLoaded(dataUrl);
        });
    }

    applyToAllFronts() {
        if (!this.currentTexture) return;

        this.barBuilder.modules.forEach(moduleData => {
            this.applyToModule(moduleData, this.currentTexture);
        });
    }

    applyToModule(moduleData, texture) {
        moduleData.mesh.traverse(child => {
            if (child.isMesh && child.userData.isBrandingFront) {
                // Jeśli materiał nie został jeszcze sklonowany, klonujemy go
                if (!child.userData.originalMaterial) {
                    child.userData.originalMaterial = child.material;
                }

                // Stwórz nowy materiał z teksturą brandingu
                const customMat = child.userData.originalMaterial.clone();
                customMat.map = texture;
                customMat.needsUpdate = true;
                child.material = customMat;
            }
        });
    }

    resetBranding() {
        this.currentTexture = null;
        this.currentDataUrl = null;

        this.barBuilder.modules.forEach(moduleData => {
            moduleData.mesh.traverse(child => {
                if (child.isMesh && child.userData.isBrandingFront && child.userData.originalMaterial) {
                    child.material = child.userData.originalMaterial;
                }
            });
        });
    }
}
