import * as THREE from 'three';

/**
 * Generator fotorealistycznego modelu dwudrzwiowej lodówki barowej Artbar.
 * Zgodny ze wzorami z renderów (czarna obudowa, przeszklone drzwi, podświetlenie, półki z napojami).
 */
export class FridgeGenerator {
    static createFridgeModel() {
        const fridgeGroup = new THREE.Group();
        fridgeGroup.name = 'FridgeRoot';

        // Wymiary dopasowane do modułu zaplecza (regału):
        // Szerokość: 1.0m, Wysokość: 2.15m, Głębokość: 0.65m
        const width = 1.0;
        const height = 2.15;
        const depth = 0.65;
        const wallThickness = 0.04;

        // Materiały
        const blackMetalMat = new THREE.MeshStandardMaterial({
            color: 0x1a1a1a,
            roughness: 0.35,
            metalness: 0.8
        });

        const darkInteriorMat = new THREE.MeshStandardMaterial({
            color: 0x222222,
            roughness: 0.5,
            metalness: 0.3
        });

        const chromeMat = new THREE.MeshStandardMaterial({
            color: 0xd0d0d0,
            roughness: 0.15,
            metalness: 0.95
        });

        const shelfMat = new THREE.MeshStandardMaterial({
            color: 0xcccccc,
            roughness: 0.3,
            metalness: 0.8,
            wireframe: false
        });

        const glassMat = new THREE.MeshPhysicalMaterial({
            color: 0xffffff,
            transparent: true,
            opacity: 0.35,
            roughness: 0.05,
            metalness: 0.1,
            transmission: 0.85,
            ior: 1.5,
            reflectivity: 0.9
        });

        const ledLightMat = new THREE.MeshBasicMaterial({
            color: 0xdff4ff
        });

        // 1. Obudowa zewnętrzna (Boxy tworzące szafę)
        // Ściana tylna
        const backGeom = new THREE.BoxGeometry(width, height, wallThickness);
        const backMesh = new THREE.Mesh(backGeom, blackMetalMat);
        backMesh.position.set(0, height / 2, -depth / 2 + wallThickness / 2);
        fridgeGroup.add(backMesh);

        // Ściana lewa
        const sideGeom = new THREE.BoxGeometry(wallThickness, height, depth);
        const leftMesh = new THREE.Mesh(sideGeom, blackMetalMat);
        leftMesh.position.set(-width / 2 + wallThickness / 2, height / 2, 0);
        fridgeGroup.add(leftMesh);

        // Ściana prawa
        const rightMesh = new THREE.Mesh(sideGeom, blackMetalMat);
        rightMesh.position.set(width / 2 - wallThickness / 2, height / 2, 0);
        fridgeGroup.add(rightMesh);

        // Góra (daszek z panelem LED/agregatem)
        const topGeom = new THREE.BoxGeometry(width, 0.18, depth);
        const topMesh = new THREE.Mesh(topGeom, blackMetalMat);
        topMesh.position.set(0, height - 0.09, 0);
        fridgeGroup.add(topMesh);

        // Dół (cokoł z kratką wentylacyjną)
        const bottomGeom = new THREE.BoxGeometry(width, 0.14, depth);
        const bottomMesh = new THREE.Mesh(bottomGeom, blackMetalMat);
        bottomMesh.position.set(0, 0.07, 0);
        fridgeGroup.add(bottomMesh);

        // 2. Wnętrze i półki
        const shelfCount = 4;
        const interiorBottom = 0.15;
        const interiorTop = height - 0.20;
        const stepY = (interiorTop - interiorBottom) / (shelfCount + 1);

        // Wewnętrzne oświetlenie LED na suficie lodówki
        const ledStripGeom = new THREE.BoxGeometry(width - 0.1, 0.02, 0.04);
        const ledStrip = new THREE.Mesh(ledStripGeom, ledLightMat);
        ledStrip.position.set(0, interiorTop - 0.01, 0);
        fridgeGroup.add(ledStrip);

        // Półki kratkowe + butelki / puszki
        const bottleColors = [0x118833, 0x992211, 0xcca010, 0x2244aa, 0xeeeeee];
        for (let i = 1; i <= shelfCount; i++) {
            const shelfY = interiorBottom + i * stepY;
            const shelfGeom = new THREE.BoxGeometry(width - wallThickness * 2 - 0.02, 0.015, depth - wallThickness - 0.06);
            const shelf = new THREE.Mesh(shelfGeom, shelfMat);
            shelf.position.set(0, shelfY, 0.01);
            fridgeGroup.add(shelf);

            // Rzędy butelek na półce (dla fotorealizmu)
            const bottlesPerRow = 6;
            const bottleWidth = (width - 0.2) / bottlesPerRow;
            for (let b = 0; b < bottlesPerRow; b++) {
                const bX = -width / 2 + 0.1 + b * bottleWidth + bottleWidth / 2;
                const bHeight = 0.18;
                const bottleGeom = new THREE.CylinderGeometry(0.028, 0.03, bHeight, 12);
                const bottleMat = new THREE.MeshStandardMaterial({
                    color: bottleColors[(i + b) % bottleColors.length],
                    roughness: 0.1,
                    metalness: 0.2,
                    transparent: true,
                    opacity: 0.85
                });
                const bottle = new THREE.Mesh(bottleGeom, bottleMat);
                bottle.position.set(bX, shelfY + bHeight / 2 + 0.008, 0.02);
                fridgeGroup.add(bottle);

                // Drugi rząd (nieco z tyłu)
                const bottle2 = new THREE.Mesh(bottleGeom, bottleMat);
                bottle2.position.set(bX, shelfY + bHeight / 2 + 0.008, -0.09);
                fridgeGroup.add(bottle2);
            }
        }

        // 3. Przeszklone drzwi dwuskrzydłowe (lewe i prawe)
        const doorWidth = (width - 0.02) / 2;
        const doorHeight = height - 0.32;
        const doorY = 0.14 + doorHeight / 2;
        const doorZ = depth / 2 - 0.01;

        [-1, 1].forEach(side => {
            const doorGroup = new THREE.Group();
            const doorCenterX = side * (doorWidth / 2);

            // Rama drzwi
            const frameThickness = 0.035;
            const frameMat = blackMetalMat;

            // Szyba
            const paneGeom = new THREE.BoxGeometry(doorWidth - frameThickness * 1.5, doorHeight - frameThickness * 1.5, 0.012);
            const glassPane = new THREE.Mesh(paneGeom, glassMat);
            glassPane.position.set(doorCenterX, doorY, doorZ);
            fridgeGroup.add(glassPane);

            // Obramowanie szyby
            // Poziome (góra i dół)
            const hFrameGeom = new THREE.BoxGeometry(doorWidth, frameThickness, 0.025);
            const topF = new THREE.Mesh(hFrameGeom, frameMat);
            topF.position.set(doorCenterX, doorY + doorHeight / 2 - frameThickness / 2, doorZ);
            fridgeGroup.add(topF);

            const botF = new THREE.Mesh(hFrameGeom, frameMat);
            botF.position.set(doorCenterX, doorY - doorHeight / 2 + frameThickness / 2, doorZ);
            fridgeGroup.add(botF);

            // Pionowe (boki)
            const vFrameGeom = new THREE.BoxGeometry(frameThickness, doorHeight, 0.025);
            const leftF = new THREE.Mesh(vFrameGeom, frameMat);
            leftF.position.set(doorCenterX - doorWidth / 2 + frameThickness / 2, doorY, doorZ);
            fridgeGroup.add(leftF);

            const rightF = new THREE.Mesh(vFrameGeom, frameMat);
            rightF.position.set(doorCenterX + doorWidth / 2 - frameThickness / 2, doorY, doorZ);
            fridgeGroup.add(rightF);

            // Uchwyt/Klamka pionowa ze stali chromowanej
            const handleGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.45, 12);
            const handle = new THREE.Mesh(handleGeom, chromeMat);
            const handleX = side < 0 ? doorCenterX + doorWidth / 2 - 0.04 : doorCenterX - doorWidth / 2 + 0.04;
            handle.position.set(handleX, doorY, doorZ + 0.03);
            fridgeGroup.add(handle);
        });

        // Włącz cienie dla wszystkich siatek w lodówce
        fridgeGroup.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
            }
        });

        return fridgeGroup;
    }
}
