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
        this.lastGhostIntersect = null;

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

        // Zapamiętanie stanu podniesionego obiektu do przeniesienia (move/pickup)
        this.pickedUpOriginal = null;
        this.ghostGroupItems = null;
        this.pickedUpGroupOriginal = null;
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
            BACK_FRIDGE_SLIM: 0,
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
            } else if (m.modelKey === 'BACK_FRIDGE_SLIM') {
                counts.BACK_FRIDGE_SLIM++;
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
        if (this.onModuleAdded) {
            this.onModuleAdded(moduleData);
        }
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
        this.generateSocketHandles(this.selectedModule);
        this.notifyChange();
    }

    /**
     * Zwraca punkt kotwiczenia menu (środek górnej krawędzi modułu) w przestrzeni świata 3D
     */
    getSelectedModuleAnchor() {
        if (!this.selectedModule || !this.selectedModule.mesh) return null;
        const pos = this.selectedModule.mesh.position;
        let height = 1.15;
        if (this.selectedModule.modelKey === 'BACK_SHELF') {
            height = 1.85;
        } else if (this.selectedModule.modelKey === 'BACK_FRIDGE' || this.selectedModule.modelKey === 'BACK_FRIDGE_SLIM') {
            height = 1.95;
        }
        return new THREE.Vector3(pos.x, height, pos.z);
    }

    /**
     * Podnosi zaznaczony moduł ze sceny do trybu przemieszczania (Ghost / Move mode)
     */
    pickupModule(moduleData = null) {
        const mod = moduleData || this.selectedModule;
        if (!mod) return null;

        // Jeśli jakikolwiek inny ghost był aktywny, wyczyść go przed podniesieniem
        this.cancelGhost();

        const orig = {
            id: mod.id,
            modelKey: mod.modelKey,
            position: mod.mesh.position.clone(),
            rotationY: mod.rotationY,
            attachedTo: mod.attachedTo
        };

        // Usuń moduł ze sceny
        this.removeModule(mod);

        // Zapamiętaj dane do ewentualnego przywrócenia przy anulowaniu (ESC/PPM)
        this.pickedUpOriginal = orig;

        // Jeśli to narożnik, używamy typu uniwersalnego 'BAR_CORNER', aby dopasowywał się do nowego złącza
        const ghostKey = (orig.modelKey === 'BAR_CORNER_RIGHT' || orig.modelKey === 'BAR_CORNER_LEFT')
            ? 'BAR_CORNER'
            : orig.modelKey;

        this.ghostModelKey = ghostKey;
        this.ghostRotation = (orig.rotationY % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
        this.ghostSnapContext = null;
        this.lastGhostIntersect = orig.position.clone();

        const initialKey = (ghostKey === 'BAR_CORNER') ? 'BAR_CORNER_RIGHT' : ghostKey;
        this.createGhostMesh(initialKey);
        if (this.ghostModule) {
            this.ghostModule.position.copy(orig.position);
            this.ghostModule.rotation.y = this.ghostRotation;
            this.setGhostVisualSnap(false);
        }

        return orig;
    }

    /**
     * Zwraca pozycje wszystkich gniazd modułu w przestrzeni świata 3D
     */
    getModuleWorldSockets(m) {
        const defs = this.registry.getSocketDefinitions(m.modelKey);
        return defs.map(d => {
            const pos = d.position.clone();
            pos.applyAxisAngle(new THREE.Vector3(0, 1, 0), m.mesh.rotation.y);
            pos.add(m.mesh.position);
            return { id: d.id, pos: pos, def: d };
        });
    }

    /**
     * Zwraca bezpośrednio połączone moduły sąsiednie (wg logicznego attachedTo oraz fizycznego styku gniazd)
     */
    getDirectNeighbors(mod) {
        const neighbors = [];
        const threshold = 0.28; // promień tolerancji styków złączy (28 cm)
        const modSockets = this.getModuleWorldSockets(mod);

        for (const other of this.modules) {
            if (other === mod) continue;

            // Sprawdź relację logiczną
            if (other.attachedTo?.parentModuleId === mod.id || mod.attachedTo?.parentModuleId === other.id) {
                neighbors.push(other);
                continue;
            }

            // Sprawdź fizyczny styk gniazd w świecie 3D
            const otherSockets = this.getModuleWorldSockets(other);
            let isConnected = false;

            for (const s1 of modSockets) {
                for (const s2 of otherSockets) {
                    if (s1.pos.distanceTo(s2.pos) < threshold) {
                        isConnected = true;
                        break;
                    }
                }
                if (isConnected) break;
            }

            if (isConnected) {
                neighbors.push(other);
            }
        }

        return neighbors;
    }

    /**
     * Przeszukuje graf połączeń (BFS) i zwraca wszystkie moduły w połączonym układzie
     */
    getConnectedModules(startModule) {
        if (!startModule) return [];

        const visited = new Set();
        const queue = [startModule];
        visited.add(startModule);

        while (queue.length > 0) {
            const current = queue.shift();
            const neighbors = this.getDirectNeighbors(current);

            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    queue.push(neighbor);
                }
            }
        }

        return Array.from(visited);
    }

    /**
     * Podnosi cały połączony układ (wybrany moduł oraz wszystkie fizycznie/logicznie połączone z nim moduły)
     */
    pickupGroup(moduleData = null) {
        const anchor = moduleData || this.selectedModule;
        if (!anchor) return null;

        this.cancelGhost();

        const connectedModules = this.getConnectedModules(anchor);
        if (connectedModules.length <= 1) {
            return this.pickupModule(anchor);
        }

        const origList = connectedModules.map(m => ({
            id: m.id,
            modelKey: m.modelKey,
            position: m.mesh.position.clone(),
            rotationY: m.rotationY,
            attachedTo: m.attachedTo
        }));

        this.pickedUpGroupOriginal = {
            anchorId: anchor.id,
            modules: origList
        };

        const anchorPos = anchor.mesh.position.clone();
        const anchorRot = (anchor.rotationY % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

        // Oblicz relatywne pozycje każdego modułu względem modułu bazowego
        const groupItems = connectedModules.map(m => {
            const worldPos = m.mesh.position.clone();
            const relPos = worldPos.sub(anchorPos).applyAxisAngle(new THREE.Vector3(0, 1, 0), -anchorRot);
            const relRot = (m.rotationY - anchorRot) % (2 * Math.PI);
            return {
                modelKey: m.modelKey,
                relPos: relPos,
                relRot: relRot,
                isAnchor: (m === anchor)
            };
        });

        // Usuń moduły grupy ze sceny
        connectedModules.forEach(m => this.removeModule(m));

        // Utwórz grupę ghost
        this.ghostGroupItems = groupItems;
        this.ghostModelKey = 'GROUP';
        this.ghostRotation = anchorRot;
        this.ghostSnapContext = null;
        this.lastGhostIntersect = anchorPos.clone();

        const groupMesh = new THREE.Group();
        groupItems.forEach(item => {
            const mesh = this.registry.instantiate(item.modelKey);
            if (!mesh) return;

            mesh.position.copy(item.relPos);
            mesh.rotation.y = item.relRot;

            mesh.traverse(child => {
                if (child.isMesh) {
                    child.material = child.material.clone();
                    child.material.transparent = true;
                    child.material.opacity = 0.55;
                    child.material.depthWrite = false;
                }
            });

            groupMesh.add(mesh);
        });

        groupMesh.position.copy(anchorPos);
        groupMesh.rotation.y = anchorRot;

        this.ghostModule = groupMesh;
        this.scene.add(this.ghostModule);

        return this.pickedUpGroupOriginal;
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
     * Automatycznie rozpoznaje i dobiera odpowiedni wariant narożnika (prawy vs lewy)
     * w zależności od modułu bazowego i wybranego gniazda połączeniowego
     */
    resolveCornerVariant(parentModule, socketDef, requestedKey) {
        if (requestedKey !== 'BAR_CORNER') {
            return requestedKey;
        }

        if (!parentModule || !socketDef) {
            return 'BAR_CORNER_RIGHT';
        }

        // Gdy dołączamy do prostego baru:
        if (parentModule.modelKey === 'BAR_STRAIGHT') {
            if (socketDef.id === 'right') {
                return 'BAR_CORNER_RIGHT'; // Prawa strona baru -> zakręt do środka w prawo
            }
            if (socketDef.id === 'left') {
                return 'BAR_CORNER_LEFT';  // Lewa strona baru -> zakręt do środka w lewo
            }
        }

        // Gdy dołączamy do istniejącego narożnika:
        if (parentModule.modelKey === 'BAR_CORNER_RIGHT') {
            return 'BAR_CORNER_RIGHT';
        }
        if (parentModule.modelKey === 'BAR_CORNER_LEFT') {
            return 'BAR_CORNER_LEFT';
        }

        return 'BAR_CORNER_RIGHT';
    }

    /**
     * Oblicza docelową pozycję i kąt obrotu modułu dołączanego do danego gniazda
     */
    computeSocketAttachment(parentModule, socketDef, newModelKey) {
        const parentPos = parentModule.mesh.position;
        const parentRot = parentModule.mesh.rotation.y;

        // Rozwiąż ogólny typ 'BAR_CORNER' na dedykowany wariant lewy lub prawy
        const effectiveNewKey = this.resolveCornerVariant(parentModule, socketDef, newModelKey);

        // Wymiary z kalibracji
        const parentCal = this.registry.getCalibrationFor(parentModule.modelKey) || { width: 1.5 };
        const newCal = this.registry.getCalibrationFor(effectiveNewKey) || { width: 1.5 };

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

        return { targetPos, targetRot, resolvedKey: effectiveNewKey };
    }

    /**
     * Dołącza nowy moduł do wybranego gniazda (kropki)
     */
    attachModuleToSocket(parentModule, socketDef, newModelKey) {
        const { targetPos, targetRot, resolvedKey } = this.computeSocketAttachment(parentModule, socketDef, newModelKey);
        const effectiveKey = resolvedKey || newModelKey;

        const newModule = this.addModule(effectiveKey, targetPos, targetRot);
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
     * Sprawdza czy dwa kąty w radianach reprezentują ten sam obrót (modulo 2*PI)
     */
    isSameRotation(rotA, rotB, tolerance = 0.08) {
        const norm = (angle) => {
            let a = angle % (2 * Math.PI);
            if (a < 0) a += 2 * Math.PI;
            return a;
        };
        const a1 = norm(rotA);
        const a2 = norm(rotB);
        const diff = Math.abs(a1 - a2);
        return Math.min(diff, 2 * Math.PI - diff) < tolerance;
    }

    /**
     * Wyszukuje najbliższe kompatybilne i wolne gniazdo do przyciągnięcia (Magnetic Snap)
     */
    findBestSocketSnap(cursorPoint, modelKey, currentRotation = this.ghostRotation) {
        if (!cursorPoint || !modelKey) return null;

        let bestSnap = null;
        let minDistance = 1.10; // Promień przyciągania: 1.1m

        const isFridge = (k) => k === 'BACK_FRIDGE' || k === 'BACK_FRIDGE_SLIM';
        const isShelf = (k) => k === 'BACK_SHELF';

        for (const m of this.modules) {
            // Wymóg: lodówki przyciągają się do regałów (oraz między sobą) tylko wtedy, gdy są tak samo obrócone
            if (
                (isFridge(modelKey) && isShelf(m.modelKey)) ||
                (isShelf(modelKey) && isFridge(m.modelKey)) ||
                (isFridge(modelKey) && isFridge(m.modelKey)) ||
                (isShelf(modelKey) && isShelf(m.modelKey))
            ) {
                if (currentRotation !== undefined && !this.isSameRotation(currentRotation, m.mesh.rotation.y)) {
                    continue;
                }
            }

            const defs = this.registry.getSocketDefinitions(m.modelKey);
            for (const socketDef of defs) {
                // Czy dany model może być podłączony do tego gniazda?
                const isCompatible = socketDef.compatible && (
                    socketDef.compatible.includes(modelKey) ||
                    (modelKey === 'BAR_CORNER' && (
                        socketDef.compatible.includes('BAR_CORNER') ||
                        socketDef.compatible.includes('BAR_CORNER_RIGHT') ||
                        socketDef.compatible.includes('BAR_CORNER_LEFT')
                    ))
                );

                if (!isCompatible) {
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

                // Oblicz docelową pozycję modułu i rozwiąż wariant
                const { targetPos, targetRot, resolvedKey } = this.computeSocketAttachment(m, socketDef, modelKey);

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
                        resolvedKey: resolvedKey,
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
        this.lastGhostIntersect = null;

        const initialKey = (modelKey === 'BAR_CORNER') ? 'BAR_CORNER_RIGHT' : modelKey;
        this.createGhostMesh(initialKey);
    }

    createGhostMesh(meshKey) {
        if (this.ghostModule) {
            this.scene.remove(this.ghostModule);
            this.ghostModule = null;
        }

        const mesh = this.registry.instantiate(meshKey);
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
        this.currentGhostMeshKey = meshKey;
        this.scene.add(this.ghostModule);
    }

    switchGhostMesh(newMeshKey) {
        if (!this.ghostModule || this.currentGhostMeshKey === newMeshKey) return;

        const curPos = this.ghostModule.position.clone();
        const curRot = this.ghostModule.rotation.y;
        const isSnapped = !!this.ghostSnapContext;

        this.createGhostMesh(newMeshKey);

        if (this.ghostModule) {
            this.ghostModule.position.copy(curPos);
            this.ghostModule.rotation.y = curRot;
            this.setGhostVisualSnap(isSnapped);
        }
    }

    updateGhost(intersectPoint) {
        if (!this.ghostModule || !intersectPoint) return;
        this.lastGhostIntersect = intersectPoint.clone();

        if (this.ghostGroupItems) {
            // Ruch całej grupy połączonych modułów: precyzyjne pozycjonowanie na siatce 0.25m
            const snap = 0.25;
            const snappedX = Math.round(intersectPoint.x / snap) * snap;
            const snappedZ = Math.round(intersectPoint.z / snap) * snap;

            this.ghostModule.position.set(snappedX, 0, snappedZ);
            this.ghostModule.rotation.y = this.ghostRotation;
            this.setGhostVisualSnap(false);
            return;
        }

        // Sprawdź czy w pobliżu kursora znajduje się pasujące gniazdo do przyciągnięcia
        const snapCandidate = this.findBestSocketSnap(intersectPoint, this.ghostModelKey, this.ghostRotation);

        if (snapCandidate) {
            this.ghostSnapContext = snapCandidate;

            // Jeśli przyciągnięty narożnik wymaga innego wariantu (lewy vs prawy), zamień siatkę
            if (this.ghostModelKey === 'BAR_CORNER' && snapCandidate.resolvedKey && snapCandidate.resolvedKey !== this.currentGhostMeshKey) {
                this.switchGhostMesh(snapCandidate.resolvedKey);
            }

            this.ghostModule.position.copy(snapCandidate.targetPos);
            this.ghostModule.rotation.y = snapCandidate.targetRot;
            this.setGhostVisualSnap(true);
        } else {
            this.ghostSnapContext = null;

            // Po wyjściu z pola przyciągania zresetuj narożnik do wariantu podstawowego
            if (this.ghostModelKey === 'BAR_CORNER' && this.currentGhostMeshKey !== 'BAR_CORNER_RIGHT') {
                this.switchGhostMesh('BAR_CORNER_RIGHT');
            }

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
        this.ghostRotation = (this.ghostRotation + delta) % (2 * Math.PI);
        if (this.ghostRotation < 0) this.ghostRotation += 2 * Math.PI;

        const testPoint = this.lastGhostIntersect || (this.ghostModule ? this.ghostModule.position : null);
        if (testPoint) {
            this.updateGhost(testPoint);
        } else if (this.ghostModule) {
            this.ghostModule.rotation.y = this.ghostRotation;
        }
    }

    commitGhost() {
        if (!this.ghostModule || !this.ghostModelKey) return null;

        // Oznacz przenoszenie jako pomyślnie zakończone (nie przywracaj starego)
        this.pickedUpOriginal = null;

        // Obsługa zatwierdzenia przemieszczania całej grupy modułów
        if (this.ghostGroupItems) {
            let anchorMod = null;
            const groupAngle = this.ghostModule.rotation.y;
            const groupPos = this.ghostModule.position.clone();
            const groupItems = this.ghostGroupItems;

            this.pickedUpGroupOriginal = null;
            this.cancelGhost();

            groupItems.forEach(item => {
                const worldPos = item.relPos.clone()
                    .applyAxisAngle(new THREE.Vector3(0, 1, 0), groupAngle)
                    .add(groupPos);
                const worldRot = (groupAngle + item.relRot) % (2 * Math.PI);
                const newMod = this.addModule(item.modelKey, worldPos, worldRot);
                if (item.isAnchor && newMod) {
                    anchorMod = newMod;
                }
            });

            if (anchorMod) {
                this.selectModule(anchorMod);
            }
            return anchorMod;
        }

        let mod = null;
        if (this.ghostSnapContext) {
            // Dołącz do przyciągniętego gniazda z pełnymi metadanymi i offsetem
            const { parentModule, socketDef, resolvedKey } = this.ghostSnapContext;
            const keyToAttach = resolvedKey || this.ghostModelKey;
            mod = this.attachModuleToSocket(parentModule, socketDef, keyToAttach);
        } else {
            // Postaw swobodnie na podłodze
            const pos = this.ghostModule.position.clone();
            const rot = this.ghostRotation;
            const key = (this.ghostModelKey === 'BAR_CORNER')
                ? (this.currentGhostMeshKey || 'BAR_CORNER_RIGHT')
                : this.ghostModelKey;
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
            this.currentGhostMeshKey = null;
            this.ghostSnapContext = null;
            this.lastGhostIntersect = null;
            this.ghostGroupItems = null;
        }

        // Jeśli cała grupa była podniesiona (move group) i anulowano (ESC/PPM), przywróć wszystkie moduły
        if (this.pickedUpGroupOriginal) {
            const groupOrig = this.pickedUpGroupOriginal;
            this.pickedUpGroupOriginal = null;
            let anchorMod = null;
            groupOrig.modules.forEach(orig => {
                const restored = this.addModule(orig.modelKey, orig.position, orig.rotationY);
                if (restored) {
                    restored.attachedTo = orig.attachedTo;
                    if (orig.id === groupOrig.anchorId) {
                        anchorMod = restored;
                    }
                }
            });
            if (anchorMod) {
                this.selectModule(anchorMod);
            }
            return;
        }

        // Jeśli pojedynczy obiekt był podniesiony (move) i użytkownik anulował akcję (ESC/PPM), przywróć go
        if (this.pickedUpOriginal) {
            const orig = this.pickedUpOriginal;
            this.pickedUpOriginal = null;
            const restored = this.addModule(orig.modelKey, orig.position, orig.rotationY);
            if (restored) {
                restored.attachedTo = orig.attachedTo;
                this.selectModule(restored);
            }
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
