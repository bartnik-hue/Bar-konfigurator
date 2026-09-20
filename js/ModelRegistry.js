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
            },
            fridgeSlim: {
                width: 0.500,
                offsetX: 0.000,
                offsetY: 0.000,
                offsetZ: 0.000,
                rotY: 0
            },
            logoBarStraight: {
                width: 1.200,
                height: 0.450,
                offsetX: 0.000,
                offsetY: 0.550,
                offsetZ: 0.225,
                rotY: 0
            },
            logoCornerRight: {
                width: 0.700,
                height: 0.450,
                offsetX: 0.150,
                offsetY: 0.550,
                offsetZ: 0.150,
                rotY: 45
            },
            logoCornerLeft: {
                width: 0.700,
                height: 0.450,
                offsetX: -0.150,
                offsetY: 0.550,
                offsetZ: 0.150,
                rotY: -45
            }
        };

        this.placeholderLogoTexture = null;
        this.activeLogoTexture = null;
        this.isLogoEnabled = false;
        this.loadPlaceholderTexture();

        this.calibration = this.loadCalibration();
    }

    loadPlaceholderTexture() {
        const texLoader = new THREE.TextureLoader();
        texLoader.load('wzor/dlugi alpha0001.png', (tex) => {
            tex.colorSpace = THREE.SRGBColorSpace;
            this.placeholderLogoTexture = tex;
            if (!this.activeLogoTexture) {
                this.updateAllLogoPlanes(tex);
            }
        });
    }

    loadCalibration() {
        const saved = localStorage.getItem('artbar_calibration_v9') || localStorage.getItem('artbar_calibration_v8');
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
        localStorage.setItem('artbar_calibration_v9', JSON.stringify(this.calibration));
    }

    resetCalibration() {
        this.calibration = JSON.parse(JSON.stringify(this.defaultCalibration));
        this.saveCalibration();
    }

    async loadAllModels(onProgress) {
        const modelsToLoad = [
            { key: 'BAR_STRAIGHT', url: 'MODELE/BarModel.glb',     label: 'Moduł prosty baru' },
            { key: 'RAW_CORNER',   url: 'MODELE/rog.glb?v=2',      label: 'Narożnik' },
            { key: 'BACK_SHELF',   url: 'MODELE/regal.glb',        label: 'Regał zaplecza' }
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

        // 5. Wygeneruj modele lodówek (dwudrzwiowa 1.0m oraz jednodrzwiowa Slim 0.5m)
        const fridgeRaw = FridgeGenerator.createFridgeModel();
        const fridgeCentered = this.createCenteredWrapper(fridgeRaw);
        this.templates.set('BACK_FRIDGE', fridgeCentered);

        const fridgeSlimRaw = FridgeGenerator.createSingleFridgeModel();
        const fridgeSlimCentered = this.createCenteredWrapper(fridgeSlimRaw);
        this.templates.set('BACK_FRIDGE_SLIM', fridgeSlimCentered);

        loadedCount += 2;
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
                    if (Array.isArray(child.material)) {
                        child.material = child.material.map(m => {
                            const cloned = m.clone();
                            cloned.side = THREE.DoubleSide;
                            return cloned;
                        });
                    } else {
                        child.material = child.material.clone();
                        child.material.side = THREE.DoubleSide;
                    }
                }
                if (child.userData.isCornerFront) {
                    child.geometry = child.geometry.clone();
                    this.normalizeCornerFrontUVs(child.geometry, true);
                }
                if (this.isBrandingTarget(child)) {
                    child.userData.isBrandingFront = true;
                }
            }
        });

        return mirroredWrapper;
    }

    /**
     * Zastąpiono dedykowanymi nakładkami (LogoPlane).
     * Wyłączono nadpisywanie materiałów samego modelu GLB, aby grafika nie przenikała na tył mebla.
     */
    isBrandingTarget(child) {
        return false;
    }

    normalizeFrontUVs(geometry) {
        if (!geometry || !geometry.attributes.position || !geometry.attributes.uv) return;
        const pos = geometry.attributes.position;
        const uv = geometry.attributes.uv;

        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
        }

        const spanX = maxX - minX || 1;
        const spanY = maxY - minY || 1;

        for (let i = 0; i < pos.count; i++) {
            const u = (pos.getX(i) - minX) / spanX;
            const v = (pos.getY(i) - minY) / spanY;
            uv.setXY(i, u, v);
        }
        uv.needsUpdate = true;
    }

    /**
     * Rozwija i normalizuje współrzędne UV frontu narożnika (dwa skrzydła pod kątem 90°)
     * wzdłuż pełnego obwodu lica (u od 0.0 na wejściu do 1.0 na wyjściu złącza)
     */
    normalizeCornerFrontUVs(geometry, isMirrored = false) {
        if (!geometry || !geometry.attributes.position || !geometry.attributes.uv || !geometry.index) return;
        const pos = geometry.attributes.position;
        const uv = geometry.attributes.uv;
        const indices = geometry.index.array;

        // Wymiary narożnika w pliku rog.glb:
        // Skrzydło 1: od wejścia X = -0.3302 do rogu X = 0.3822 (długość 0.7124m)
        // Skrzydło 2: od rogu Z = 0.3400 do wyjścia Z = -0.3300 (długość 0.6700m)
        const entranceX = -0.3302;
        const cornerX = 0.3822;
        const cornerZ = 0.3400;
        const exitZ = -0.3300;

        const L1 = cornerX - entranceX; // 0.7124m
        const L2 = cornerZ - exitZ;     // 0.6700m
        const totalL = L1 + L2;         // 1.3824m

        const minY = 0.09708;
        const maxY = 1.20000;
        const spanY = maxY - minY;

        // Zewnętrzne przednie lico narożnika to 24 indeksy (8 trójkątów, od 717 do 741).
        // Indeksy 741..747 to wewnętrzna ścianka narożnika i pozostają przy materiale konstrukcyjnym 'frame'.
        const startIndex = (geometry.index.count === 747) ? 717 : 0;
        const endIndex = (geometry.index.count === 747) ? 741 : geometry.index.count;
        const visited = new Set();

        for (let i = startIndex; i < endIndex; i++) {
            const idx = indices[i];
            if (visited.has(idx)) continue;
            visited.add(idx);

            const px = pos.getX(idx);
            const py = pos.getY(idx);
            const pz = pos.getZ(idx);

            let distAlong = 0;
            if (pz >= 0.33) {
                distAlong = Math.max(0, Math.min(L1, px - entranceX));
            } else {
                const distZ = cornerZ - pz;
                distAlong = L1 + Math.max(0, Math.min(L2, distZ));
            }

            let u = distAlong / totalL;
            if (isMirrored) {
                u = 1.0 - u;
            }
            const v = Math.max(0, Math.min(1, (py - minY) / spanY));

            uv.setXY(idx, u, v);
        }
        uv.needsUpdate = true;
    }

    setupShadowsAndMaterials(root, modelKey) {
        root.traverse(child => {
            if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;

                // Oznacz siatki z materiałem 'front', planszę baru prostego lub lico narożnika dla tła panoramicznego
                const mats = Array.isArray(child.material) ? child.material : [child.material];
                const hasFrontMat = mats.some(m => m && (m.name === 'front' || m.name.toLowerCase().includes('front')));

                const isFrontBoard = (child.name && (child.name.toLowerCase().includes('plansza') || child.name.toLowerCase().includes('barart.104'))) ||
                                     (child.parent && child.parent.name && child.parent.name.toLowerCase().includes('plansza'));

                const isCornerMesh = (child.name && child.name.toLowerCase().includes('barart.002')) ||
                                     (child.geometry && child.geometry.index && child.geometry.index.count === 747);

                if (hasFrontMat) {
                    child.userData.isFrontPanel = true;
                    this.normalizeFrontUVs(child.geometry);
                } else if (isFrontBoard) {
                    child.userData.isFrontPanel = true;
                    const origMat = mats[0];
                    const frontMat = origMat.clone();
                    frontMat.name = 'front';
                    frontMat.side = THREE.DoubleSide;
                    origMat.name = 'frame';

                    // W siatce BarArt.104 z 36 indeksami (12 trójkątów z Blender):
                    // Pierwsze 6 indeksów (2 trójkąty) to dokładnie lico frontu (Z=0.024m), a pozostałe 30 to krawędzie i tył
                    if (child.geometry && child.geometry.index && child.geometry.index.count === 36) {
                        child.geometry.clearGroups();
                        child.geometry.addGroup(0, 6, 0);  // Grupa 0: przednia ściana -> materiał 'front'
                        child.geometry.addGroup(6, 30, 1); // Grupa 1: tył i krawędzie -> oryginalny materiał
                        child.material = [frontMat, origMat];
                    } else {
                        child.material = frontMat;
                    }
                    this.normalizeFrontUVs(child.geometry);
                } else if (isCornerMesh) {
                    child.userData.isFrontPanel = true;
                    child.userData.isCornerFront = true;
                    const origMat = mats[0];
                    const frontMat = origMat.clone();
                    frontMat.name = 'front';
                    frontMat.side = THREE.DoubleSide;
                    origMat.name = 'frame';

                    // W siatce BarArt.002 z 747 indeksami (249 trójkątów):
                    // - Indeksy 0..717: korpus, blat i półki narożnika -> materiał 'frame'
                    // - Indeksy 717..741 (24 indeksy / 8 trójkątów): ZEWNĘTRZNE lico narożnika -> materiał 'front'
                    // - Indeksy 741..747 (6 indeksów / 2 trójkąty): WEWNĘTRZNA ścianka narożnika -> materiał 'frame' (brak grafiki wewnątrz)
                    if (child.geometry && child.geometry.index && child.geometry.index.count === 747) {
                        child.geometry.clearGroups();
                        child.geometry.addGroup(0, 717, 0);  // Grupa 0: korpus i blat -> 'frame'
                        child.geometry.addGroup(717, 24, 1); // Grupa 1: zewnętrzne lico -> 'front'
                        child.geometry.addGroup(741, 6, 0);  // Grupa 2: wewnętrzna ścianka -> 'frame'
                        child.material = [origMat, frontMat];
                    } else {
                        child.material = frontMat;
                    }
                    this.normalizeCornerFrontUVs(child.geometry, false);
                }

                // Oznacz siatki frontowe dla brandingu
                if (this.isBrandingTarget(child)) {
                    child.userData.isBrandingFront = true;
                }

                // Oznacz siatki z materiałem 'led' dla podświetlenia LED
                const hasLedMat = mats.some(m => m && (m.name || '').toLowerCase().includes('led'));
                if (hasLedMat) {
                    child.userData.isLedMesh = true;
                    mats.forEach(m => {
                        if (m && (m.name || '').toLowerCase().includes('led')) {
                            m.emissive = new THREE.Color('#FACB7D');
                            m.emissiveIntensity = 2.5;
                            m.color = new THREE.Color('#FACB7D');
                            m.roughness = 0.2;
                            m.metalness = 0.0;
                        }
                    });
                }

                if (child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach(m => {
                        m.side = THREE.DoubleSide;
                        if (m.map) {
                            m.map.anisotropy = 8;
                        }
                    });
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

        // Klonuj materiały instancji, aby moduły mogły mieć unikalne mapowanie UV panoramy
        clone.traverse(child => {
            if (child.isMesh && child.material) {
                child.material = Array.isArray(child.material)
                    ? child.material.map(m => m.clone())
                    : child.material.clone();
            }
        });

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

        // Dodaj dedykowany plane na logo wyłącznie dla baru prostego (BAR_STRAIGHT)
        if (effectiveKey === 'BAR_STRAIGHT') {
            const logoPlane = this.createLogoPlane(effectiveKey);
            if (logoPlane) {
                wrapper.add(logoPlane);
            }
        }

        return wrapper;
    }

    getLogoCalibrationKey(modelKey) {
        if (modelKey === 'BAR_STRAIGHT') return 'logoBarStraight';
        return null;
    }

    createLogoPlane(modelKey) {
        const calKey = this.getLogoCalibrationKey(modelKey);
        if (!calKey) return null;

        const cal = this.calibration[calKey] || {};
        const width = cal.width || 1.20;
        const height = cal.height || 0.45;

        const geom = new THREE.PlaneGeometry(width, height);
        const mat = new THREE.MeshBasicMaterial({
            map: this.activeLogoTexture || this.placeholderLogoTexture || null,
            transparent: true,
            opacity: 0.99,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
            side: THREE.FrontSide
        });

        const mesh = new THREE.Mesh(geom, mat);
        mesh.name = 'LogoPlane';
        mesh.userData.isLogoPlane = true;
        mesh.userData.logoKey = calKey;
        mesh.position.set(cal.offsetX || 0, cal.offsetY !== undefined ? cal.offsetY : 0.55, cal.offsetZ !== undefined ? cal.offsetZ : 0.225);
        mesh.rotation.y = (cal.rotY || 0) * (Math.PI / 180);
        mesh.visible = this.isLogoEnabled === true;

        return mesh;
    }

    updateAllLogoPlanes(texture) {
        if (window.app?.barBuilder?.modules) {
            window.app.barBuilder.modules.forEach(m => {
                const plane = m.mesh.getObjectByName('LogoPlane');
                if (plane && plane.material) {
                    plane.material.map = texture;
                    plane.material.needsUpdate = true;
                }
            });
        }
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
            case 'BACK_SHELF':          
            case 'regal':               return this.calibration.regal;
            case 'BACK_FRIDGE':         
            case 'fridge':              return this.calibration.fridge;
            case 'BACK_FRIDGE_SLIM':
            case 'fridgeSlim':          return this.calibration.fridgeSlim || { width: 0.500, offsetX: 0, offsetY: 0, offsetZ: 0, rotY: 0 };
            case 'logoBarStraight':     return this.calibration.logoBarStraight;
            case 'logoCornerRight':     return this.calibration.logoCornerRight;
            case 'logoCornerLeft':      return this.calibration.logoCornerLeft;
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
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_LEFT', 'BAR_CORNER']
                    },
                    {
                        id: 'right',
                        label: 'Prawa strona (prosto lub róg w prawo)',
                        position: new THREE.Vector3(halfW, 0.5, 0),
                        direction: new THREE.Vector3(1, 0, 0),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_RIGHT', 'BAR_CORNER']
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
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER']
                    },
                    {
                        id: 'out',
                        label: 'Wyjście zakrętu w prawo (90°)',
                        position: new THREE.Vector3(0, 0.5, -halfW),
                        direction: new THREE.Vector3(0, 0, -1),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_RIGHT', 'BAR_CORNER']
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
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER']
                    },
                    {
                        id: 'out',
                        label: 'Wyjście zakrętu w lewo (90°)',
                        position: new THREE.Vector3(0, 0.5, -halfW),
                        direction: new THREE.Vector3(0, 0, -1),
                        compatible: ['BAR_STRAIGHT', 'BAR_CORNER_LEFT', 'BAR_CORNER']
                    }
                ];

            case 'BACK_SHELF':
            case 'BACK_FRIDGE':
            case 'BACK_FRIDGE_SLIM':
                return [
                    {
                        id: 'left',
                        label: 'Lewa strona',
                        position: new THREE.Vector3(-halfW, 0.9, 0),
                        direction: new THREE.Vector3(-1, 0, 0),
                        compatible: ['BACK_SHELF', 'BACK_FRIDGE', 'BACK_FRIDGE_SLIM']
                    },
                    {
                        id: 'right',
                        label: 'Prawa strona',
                        position: new THREE.Vector3(halfW, 0.9, 0),
                        direction: new THREE.Vector3(1, 0, 0),
                        compatible: ['BACK_SHELF', 'BACK_FRIDGE', 'BACK_FRIDGE_SLIM']
                    }
                ];

            default:
                return [];
        }
    }
}
