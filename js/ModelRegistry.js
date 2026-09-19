import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FridgeGenerator } from './FridgeGenerator.js';

/**
 * Rejestr i zarządca modeli 3D oraz punktów połączeniowych (Snap Sockets).
 * Obsługuje centrowanie pivotu w środku mebli oraz podział na Narożnik Prawy i Narożnik Lewy (odbicie lustrzane).
 */
export class ModelRegistry {
    constructor() {
        this.loader = new GLTFLoader();
        this.templates = new Map();
        
        // Domyślne wartości kalibracji z milimetrową dokładnością
        this.defaultCalibration = {
            barStraight: {
                width: 1.500,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            barCornerRight: {
                width: 0.950,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            barCornerLeft: {
                width: 0.950,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            barCornerRightOut: {
                width: 1.500,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            barCornerLeftOut: {
                width: 1.500,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            regal: {
                width: 1.500,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            fridge: {
                width: 1.000,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            }
        };

        this.calibration = this.loadCalibration();
    }

    loadCalibration() {
        const saved = localStorage.getItem('artbar_calibration_v8');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                return { ...this.defaultCalibration, ...parsed };
            } catch (e) {
                console.warn('Błąd odczytu zapisanej kalibracji, użyto domyślnej:', e);
            }
        }
        return JSON.parse(JSON.stringify(this.defaultCalibration));
    }

    saveCalibration() {
        localStorage.setItem('artbar_calibration_v8', JSON.stringify(this.calibration));
    }

    resetCalibration() {
        this.calibration = JSON.parse(JSON.stringify(this.defaultCalibration));
        this.saveCalibration();
    }

    async loadAllModels(onProgress) {
        const modelsToLoad = [
            { key: 'BAR_STRAIGHT', url: '/MODELE/BarModel.glb', label: 'Moduł prosty baru' },
            { key: 'RAW_CORNER',   url: '/MODELE/rog.glb',      label: 'Narożnik' },
            { key: 'BACK_SHELF',   url: '/MODELE/regal.glb',    label: 'Regał zaplecza' }
        ];

        let loadedCount = 0;
        const total = modelsToLoad.length + 2; // +1 dla lustrzanego rogu, +1 dla lodówki

        for (const m of modelsToLoad) {
            try {
                const gltf = await this.loadGLB(m.url);
                const scene = gltf.scene;
                this.setupShadowsAndMaterials(scene, m.key);

                if (m.key === 'RAW_CORNER') {
                    // 1. Narożnik Prawy (idealnie symetryczny miter 45° i równe ramiona modularne)
                    const cornerRight = this.createCornerRightWrapper(scene);
                    this.templates.set('BAR_CORNER_RIGHT', cornerRight);
                    this.templates.set('BAR_CORNER', cornerRight); // alias wsteczny

                    // 2. Narożnik Lewy (dokładne odbicie lustrzane narożnika prawego w osi X)
                    const mirroredLeft = this.createMirroredCorner(cornerRight);
                    this.templates.set('BAR_CORNER_LEFT', mirroredLeft);
                    loadedCount += 2;
                } else if (m.key === 'BAR_STRAIGHT') {
                    // 3. Moduł prosty baru ze skalibrowanym profilem styku
                    const barStraight = this.createBarStraightWrapper(scene);
                    this.templates.set('BAR_STRAIGHT', barStraight);
                    loadedCount++;
                } else {
                    // 4. Regał zaplecza
                    const centered = this.createCenteredWrapper(scene);
                    this.templates.set(m.key, centered);
                    loadedCount++;
                }

                if (onProgress) onProgress(loadedCount / total, `Wczytano ${m.label}`);
            } catch (err) {
                console.error(`Błąd wczytywania modelu ${m.key} z ${m.url}:`, err);
            }
        }

        // 5. Wygeneruj model lodówki
        const fridgeRaw = FridgeGenerator.createFridgeModel();
        const fridgeCentered = this.createCenteredWrapper(fridgeRaw);
        this.templates.set('BACK_FRIDGE', fridgeCentered);
        loadedCount++;
        if (onProgress) onProgress(1.0, 'Wszystkie modele gotowe');
    }

    loadGLB(url) {
        return new Promise((resolve, reject) => {
            this.loader.load(url, resolve, undefined, reject);
        });
    }

    /**
     * Zamyka model baru prostego w kontenerze wycentrowanym w X, podstawa Y=0, i Z dopasowane do płaszczyzny styku narożnika
     */
    createBarStraightWrapper(rootObject) {
        rootObject.position.set(0, 0, 0);
        rootObject.rotation.set(0, 0, 0);
        rootObject.scale.set(1, 1, 1);
        rootObject.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(rootObject);

        const wrapper = new THREE.Group();
        wrapper.name = 'CenteredBarStraightWrapper';

        // X jest wycentrowany w pliku GLB (-0.75m do +0.75m), Y spoczywa na podłodze, Z zoptymalizowany pod styk (-0.145m)
        rootObject.position.set(0, -box.min.y, -0.145);
        wrapper.add(rootObject);

        return wrapper;
    }

    /**
     * Tworzy idealnie symetryczny narożnik prawy (skalowanie miteru 45° i równe ramiona modularne)
     */
    createCornerRightWrapper(rootObject) {
        rootObject.position.set(0, 0, 0);
        rootObject.rotation.set(0, 0, 0);
        rootObject.scale.set(1, 1, 1);
        rootObject.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(rootObject);

        const wrapper = new THREE.Group();
        wrapper.name = 'CenteredCornerRightWrapper';

        // Wyrównanie symetrii ramion rogu (skala w osi X względem wewnętrznego narożnika X=0.7500)
        // Współczynnik skali: (0.555825 - (-0.330000)) / (1.665277 - 0.750020) = 0.967842
        const scaleX = 0.967842;
        const scaleNode = new THREE.Group();
        scaleNode.name = 'SymmetrizedCornerNode';

        rootObject.position.set(-0.7500, 0, 0);
        scaleNode.scale.set(scaleX, 1, 1);
        scaleNode.add(rootObject);
        scaleNode.position.set(0.7500, 0, 0);

        // Umieszczenie w kontenerze: wejście na X = -0.475 (-halfW), wyjście na Z = -0.475 (-halfW), podstawa Y=0
        const container = new THREE.Group();
        container.position.set(-1.225, -box.min.y, -0.145);
        container.add(scaleNode);

        wrapper.add(container);
        return wrapper;
    }

    /**
     * Zamyka model w kontenerze, gdzie punkt (0, 0, 0) znajduje się dokładnie w środku geometrycznym mebla na podłodze (Y=0)
     */
    createCenteredWrapper(rootObject) {
        rootObject.position.set(0, 0, 0);
        rootObject.rotation.set(0, 0, 0);
        rootObject.scale.set(1, 1, 1);
        rootObject.updateMatrixWorld(true);

        const box = new THREE.Box3().setFromObject(rootObject);
        const center = new THREE.Vector3();
        box.getCenter(center);

        const wrapper = new THREE.Group();
        wrapper.name = 'CenteredModelWrapper';

        // Przesuń zawartość tak, by geometryczny środek X i Z leżał w (0, 0), a podstawa w Y=0
        rootObject.position.set(-center.x, -box.min.y, -center.z);
        wrapper.add(rootObject);

        return wrapper;
    }

    /**
     * Tworzy czyste lustrzane odbicie wycentrowanego narożnika w osi X
     */
    createMirroredCorner(centeredRight) {
        const mirroredWrapper = new THREE.Group();
        mirroredWrapper.name = 'CenteredMirroredCorner';

        const clone = centeredRight.clone(true);
        // Odbicie w osi X względem środka bryły (który jest dokładnie w 0, 0, 0)
        clone.scale.x = -1;
        mirroredWrapper.add(clone);

        mirroredWrapper.traverse(child => {
            if (child.isMesh) {
                if (child.material) {
                    child.material = child.material.clone();
                    child.material.side = THREE.DoubleSide;
                }
                if (child.name.includes('114') || child.name.includes('PLANSZA') || child.material?.name?.includes('logiem')) {
                    child.userData.isBrandingFront = true;
                }
            }
        });

        return mirroredWrapper;
    }

    setupShadowsAndMaterials(root, modelKey) {
        root.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Oznacz siatki frontowe dla brandingu
                if (child.name.includes('PLANSZA') || child.name.includes('104') || 
                    (child.parent && child.parent.name.includes('PLANSZA')) ||
                    child.name.includes('114') || child.material?.name?.includes('logiem')) {
                    child.userData.isBrandingFront = true;
                }

                if (child.material) {
                    child.material.side = THREE.DoubleSide;
                    if (child.material.map) {
                        child.material.map.anisotropy = 8;
                    }
                }
            }
        });
    }

    /**
     * Zwraca sklonowaną instancję wybranego modelu ze strukturą pivotu i kalibracji
     */
    instantiate(modelKey) {
        // Mapuj alias 'BAR_CORNER' na 'BAR_CORNER_RIGHT'
        const effectiveKey = (modelKey === 'BAR_CORNER') ? 'BAR_CORNER_RIGHT' : modelKey;
        const template = this.templates.get(effectiveKey);
        if (!template) {
            console.error(`Brak szablonu dla modelu: ${effectiveKey}`);
            return null;
        }

        const clone = template.clone(true);

        // Główny wrapper modułu w scenie
        const wrapper = new THREE.Group();
        wrapper.name = `Module_${effectiveKey}`;
        wrapper.userData.modelKey = effectiveKey;
        wrapper.userData.isBarModule = true;

        // Węzeł pivotu (odpowiada za kalibracyjny offset i obrót wokół własnego środka)
        const pivotNode = new THREE.Group();
        pivotNode.name = 'PivotCalibrationNode';
        pivotNode.add(clone);

        // Zaaplikuj offsety kalibracyjne
        this.applyCalibrationToInstance(pivotNode, effectiveKey);

        wrapper.add(pivotNode);
        return wrapper;
    }

    applyCalibrationToInstance(pivotNode, modelKey) {
        const cal = this.getCalibrationFor(modelKey);
        if (!cal) return;

        pivotNode.position.set(cal.offsetX || 0, cal.offsetY || 0, cal.offsetZ || 0);
        pivotNode.rotation.y = (cal.rotY || 0) * (Math.PI / 180);
    }

    getCalibrationFor(modelKey) {
        switch (modelKey) {
            case 'BAR_STRAIGHT':        return this.calibration.barStraight;
            case 'BAR_CORNER_RIGHT':
            case 'BAR_CORNER':          return this.calibration.barCornerRight;
            case 'BAR_CORNER_LEFT':     return this.calibration.barCornerLeft;
            case 'barCornerRightOut':   return this.calibration.barCornerRightOut;
            case 'barCornerLeftOut':    return this.calibration.barCornerLeftOut;
            case 'BACK_SHELF':          return this.calibration.regal;
            case 'BACK_FRIDGE':         return this.calibration.fridge;
            default: return null;
        }
    }

    /**
     * Zwraca definicję punktów połączeń (gniazd) dla danego typu modułu
     */
    getSocketDefinitions(modelKey) {
        const effectiveKey = (modelKey === 'BAR_CORNER') ? 'BAR_CORNER_RIGHT' : modelKey;
        const cal = this.getCalibrationFor(effectiveKey) || {};
        const width = cal.width || 1.50;
        const halfW = width / 2;

        switch (effectiveKey) {
            case 'BAR_STRAIGHT':
                return [
                    {
                        id: 'left',
                        label: 'Lewa strona (prosto lub róg w lewo)',
                        position: new THREE.Vector3(-halfW, 0.5, 0),
                        direction: new THREE.Vector3(-1, 0, 0),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_LEFT']
                    },
                    {
                        id: 'right',
                        label: 'Prawa strona (prosto lub róg w prawo)',
                        position: new THREE.Vector3(halfW, 0.5, 0),
                        direction: new THREE.Vector3(1, 0, 0),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_RIGHT']
                    }
                ];

            case 'BAR_CORNER_RIGHT':
                // Narożnik prawy: wchodzi od lewej (-halfW), zakręca pod kątem 90° w głąb (wyjście na -halfW w osi Z)
                return [
                    {
                        id: 'in',
                        label: 'Wejście z lewej',
                        position: new THREE.Vector3(-halfW, 0.5, 0),
                        direction: new THREE.Vector3(-1, 0, 0),
                        compatible: ['BAR_STRAIGHT']
                    },
                    {
                        id: 'out',
                        label: 'Wyjście zakrętu w prawo (90°)',
                        position: new THREE.Vector3(0, 0.5, -halfW),
                        direction: new THREE.Vector3(0, 0, -1),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_RIGHT']
                    }
                ];

            case 'BAR_CORNER_LEFT':
                // Narożnik lewy: wchodzi od prawej (halfW), zakręca pod kątem 90° w głąb (wyjście na -halfW w osi Z)
                return [
                    {
                        id: 'in',
                        label: 'Wejście z prawej',
                        position: new THREE.Vector3(halfW, 0.5, 0),
                        direction: new THREE.Vector3(1, 0, 0),
                        compatible: ['BAR_STRAIGHT']
                    },
                    {
                        id: 'out',
                        label: 'Wyjście zakrętu w lewo (90°)',
                        position: new THREE.Vector3(0, 0.5, -halfW),
                        direction: new THREE.Vector3(0, 0, -1),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_LEFT']
                    }
                ];

            case 'BACK_SHELF':
            case 'BACK_FRIDGE':
                return [
                    {
                        id: 'left',
                        label: 'Lewa strona',
                        position: new THREE.Vector3(-halfW, 0.9, 0),
                        direction: new THREE.Vector3(-1, 0, 0),
                        compatible: ['BACK_SHELF', 'BACK_FRIDGE']
                    },
                    {
                        id: 'right',
                        label: 'Prawa strona',
                        position: new THREE.Vector3(halfW, 0.9, 0),
                        direction: new THREE.Vector3(1, 0, 0),
                        compatible: ['BACK_SHELF', 'BACK_FRIDGE']
                    }
                ];

            default:
                return [];
        }
    }
}
