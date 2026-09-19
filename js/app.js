import * as THREE from 'three';
window.THREE = THREE;
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { ModelRegistry } from './ModelRegistry.js';
import { BarBuilder } from './BarBuilder.js';
import { BrandingManager } from './BrandingManager.js';
import { CalibrationTool } from './CalibrationTool.js';

class ArtbarApp {
    constructor() {
        this.container = document.getElementById('viewport-container');
        this.canvas = document.getElementById('three-canvas');

        this.initThree();
        this.initLights();
        this.initEnvironment();

        this.registry = new ModelRegistry();
        this.barBuilder = new BarBuilder(this.scene, this.camera, this.renderer, this.registry, (stats) => this.updateUIStats(stats));
        this.brandingManager = new BrandingManager(this.barBuilder, this.registry);

        // Automatyczne nakładanie bieżącego brandingu na nowo dodawane moduły
        this.barBuilder.onModuleAdded = (moduleData) => {
            if (this.brandingManager.currentTexture) {
                this.brandingManager.applyToModule(moduleData, this.brandingManager.currentTexture);
            }
        };

        this.activeSocketClickContext = null;

        this.initEvents();
        this.initUI();

        // Uruchom pętlę renderowania od razu
        this.animate();

        // Uruchom ładowanie modeli
        this.loadModels();
    }

    initThree() {
        // Scena
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x121212);
        this.scene.fog = new THREE.FogExp2(0x121212, 0.035);

        // Kamera
        const aspect = window.innerWidth / window.innerHeight;
        this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
        this.camera.position.set(0, 6.5, 9.5);

        // Renderer
        this.renderer = new THREE.WebGLRenderer({
            canvas: this.canvas,
            antialias: true,
            powerPreference: 'high-performance'
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;

        // Kontroler kamery OrbitControls
        this.controls = new OrbitControls(this.camera, this.canvas);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Nie pozwól zajrzeć pod podłogę
        this.controls.minDistance = 2.0;
        this.controls.maxDistance = 40.0;
        this.controls.target.set(0, 0.6, 0);

        // Płaszczyzna raycastingu dla podłogi
        this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Resize handler
        window.addEventListener('resize', () => this.onResize());
    }

    initLights() {
        // Parametry położenia światła sferycznego
        this.lightDistance = 18.0;
        this.lightAzimuth = 38; // stopnie
        this.lightElevation = 55; // stopnie

        // Oświetlenie studyjne dopasowane do ciemnych satynowych mebli Artbar
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
        this.scene.add(this.ambientLight);

        // Główne światło kierunkowe z cieniami
        this.mainLight = new THREE.DirectionalLight(0xfffaed, 2.2);
        this.mainLight.castShadow = true;
        this.mainLight.shadow.mapSize.width = 2048;
        this.mainLight.shadow.mapSize.height = 2048;
        this.mainLight.shadow.camera.near = 0.5;
        this.mainLight.shadow.camera.far = 40;
        const d = 12;
        this.mainLight.shadow.camera.left = -d;
        this.mainLight.shadow.camera.right = d;
        this.mainLight.shadow.camera.top = d;
        this.mainLight.shadow.camera.bottom = -d;
        this.mainLight.shadow.bias = -0.0004;
        this.updateMainLightPosition();
        this.scene.add(this.mainLight);

        // Ciepłe złote światło konturowe (rim light z tyłu)
        this.goldRimLight = new THREE.DirectionalLight(0xFACB7D, 1.4);
        this.goldRimLight.position.set(-10, 8, -10);
        this.scene.add(this.goldRimLight);

        // Wypełniające chłodne światło z boku
        this.fillLight = new THREE.DirectionalLight(0xd5e2f0, 0.8);
        this.fillLight.position.set(-8, 5, 8);
        this.scene.add(this.fillLight);
    }

    updateMainLightPosition() {
        if (!this.mainLight) return;
        const azRad = this.lightAzimuth * (Math.PI / 180);
        const elRad = this.lightElevation * (Math.PI / 180);

        const rGround = this.lightDistance * Math.cos(elRad);
        const y = this.lightDistance * Math.sin(elRad);
        const x = rGround * Math.sin(azRad);
        const z = rGround * Math.cos(azRad);

        this.mainLight.position.set(x, y, z);
    }

    setSceneBackgroundColor(hex) {
        const color = new THREE.Color(hex);
        this.scene.background = color;
        if (this.scene.fog) {
            this.scene.fog.color = color;
        }

        // Dostosowanie posadzki i siatki przy bardzo jasnych kolorach tła
        const lum = (color.r * 0.299 + color.g * 0.587 + color.b * 0.114);
        if (lum > 0.6) {
            if (this.floorMesh?.material) this.floorMesh.material.color.set(0xcccccc);
            if (this.grid?.material) this.grid.material.color.set(0x888888);
        } else {
            if (this.floorMesh?.material) this.floorMesh.material.color.set(0x171717);
            if (this.grid?.material) this.grid.material.color.set(0xFACB7D);
        }
    }

    initEnvironment() {
        // Elegancka studyjna posadzka o delikatnym połysku
        const floorGeom = new THREE.PlaneGeometry(80, 80);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x171717,
            roughness: 0.5,
            metalness: 0.2
        });
        this.floorMesh = new THREE.Mesh(floorGeom, floorMat);
        this.floorMesh.rotation.x = -Math.PI / 2;
        this.floorMesh.receiveShadow = true;
        this.scene.add(this.floorMesh);

        // Siatka podłogowa (Grid)
        this.grid = new THREE.GridHelper(40, 40, 0xFACB7D, 0x2e2e2e);
        this.grid.position.y = 0.005;
        this.scene.add(this.grid);
    }

    async loadModels() {
        const loaderStatus = document.getElementById('loader-status');
        const overlay = document.getElementById('loading-overlay');

        try {
            await this.registry.loadAllModels((progress, msg) => {
                if (loaderStatus) loaderStatus.textContent = `${msg} (${Math.round(progress * 100)}%)`;
            });

            // Załaduj domyślny preset (Układ Prosty) na start
            this.barBuilder.loadPreset('straight');
            this.showToast('Wczytano modele 3D oraz przykładowy układ baru Artbar.');
        } catch (err) {
            console.error('Błąd podczas inicjalizacji modeli:', err);
            this.showToast('Wystąpił problem z wczytaniem niektórych modeli. Sprawdź konsolę.');
        } finally {
            if (overlay) {
                overlay.style.opacity = '0';
                setTimeout(() => overlay.style.display = 'none', 400);
            }
        }
    }

    initEvents() {
        this.pointerDownPos = { x: 0, y: 0, time: 0 };
        this.menuOpenedTime = 0;

        // Raycasting myszy
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));

        // Klawisze skrótów
        window.addEventListener('keydown', (e) => {
            if (e.key === 'r' || e.key === 'R') {
                if (this.barBuilder.ghostModule) {
                    this.barBuilder.rotateGhost();
                } else {
                    this.barBuilder.rotateSelected();
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.barBuilder.removeSelected();
            } else if (e.key === 'Escape') {
                this.barBuilder.cancelGhost();
                this.barBuilder.deselectModule();
                this.hideContextMenu();
                this.hideRadialMenu();
            }
        });

        // Bezpieczne zamykanie menu przy kliknięciu poza menu (nie zamyka przy otwieraniu!)
        window.addEventListener('pointerdown', (e) => {
            if (performance.now() - this.menuOpenedTime < 350) return;
            if (!e.target.closest('#context-menu')) {
                this.hideContextMenu();
            }
        });
    }

    onMouseMove(e) {
        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;

        if (this.barBuilder.ghostModule) {
            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.floorPlane, intersectPoint)) {
                this.barBuilder.updateGhost(intersectPoint);
            }
        }
    }

    onPointerDown(e) {
        if (e.button !== 0) return;
        this.pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now() };
    }

    onPointerUp(e) {
        // Tylko LPM (przycisk 0)
        if (e.button !== 0) return;

        // Jeśli kliknięto w elementy UI, ignoruj
        if (e.target.closest('.top-header') || e.target.closest('.top-actions') || 
            e.target.closest('.bottom-controls') || e.target.closest('.side-panel') || 
            e.target.closest('#context-menu') || e.target.closest('#radial-action-menu')) {
            return;
        }

        // Sprawdź czy to było kliknięcie czy przeciąganie kamery (threshold 8px)
        const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
        if (dist > 8) {
            return; // Użytkownik obracał kamerę (drag), nie wykonujemy akcji kliknięcia
        }

        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // 1. Jeśli jesteśmy w trybie stawiania ghosta -> postaw moduł w miejscu kliknięcia!
        if (this.barBuilder.ghostModule) {
            const intersectPoint = new THREE.Vector3();
            if (this.raycaster.ray.intersectPlane(this.floorPlane, intersectPoint)) {
                this.barBuilder.updateGhost(intersectPoint);
            }
            this.barBuilder.placeGhost();
            this.showToast('Postawiono moduł.');
            return;
        }

        // 2. Sprawdź kliknięcie w kropki połączeń (Socket Handles)
        const socketIntersects = this.raycaster.intersectObjects(this.barBuilder.socketHandles, true);
        if (socketIntersects.length > 0) {
            let hitGroup = socketIntersects[0].object;
            while (hitGroup.parent && !hitGroup.userData?.isSocketHandle) {
                hitGroup = hitGroup.parent;
            }

            if (hitGroup.userData?.isSocketHandle) {
                const data = hitGroup.userData;
                this.openSocketAttachMenu(e.clientX, e.clientY, data.parentModule, data.socketDef);
                return;
            }
        }

        // 3. Sprawdź kliknięcie w moduły baru
        const allMeshes = this.barBuilder.modules.map(m => m.mesh);
        const moduleIntersects = this.raycaster.intersectObjects(allMeshes, true);

        if (moduleIntersects.length > 0) {
            let hit = moduleIntersects[0].object;
            while (hit.parent && !hit.userData?.isBarModule) {
                hit = hit.parent;
            }

            const foundModule = this.barBuilder.modules.find(m => m.mesh === hit);
            if (foundModule) {
                this.barBuilder.selectModule(foundModule);
                return;
            }
        }

        // 4. Kliknięcie w puste tło odznacza moduł
        this.barBuilder.deselectModule();
        this.hideContextMenu();
        this.hideRadialMenu();
    }

    onContextMenu(e) {
        e.preventDefault();

        // Jeśli jesteśmy w trybie ghosta, PPM anuluje ghosta
        if (this.barBuilder.ghostModule) {
            this.barBuilder.cancelGhost();
            this.showToast('Anulowano stawianie / przemieszczanie modułu.');
            return;
        }

        this.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
        this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);

        // 1. Sprawdź kliknięcie PPM w kropkę połączenia (Socket Handle)
        const socketIntersects = this.raycaster.intersectObjects(this.barBuilder.socketHandles, true);
        if (socketIntersects.length > 0) {
            let hitGroup = socketIntersects[0].object;
            while (hitGroup.parent && !hitGroup.userData?.isSocketHandle) {
                hitGroup = hitGroup.parent;
            }
            if (hitGroup.userData?.isSocketHandle) {
                const data = hitGroup.userData;
                this.openSocketAttachMenu(e.clientX, e.clientY, data.parentModule, data.socketDef);
                return;
            }
        }

        // 2. Sprawdź kliknięcie PPM w istniejący moduł
        const allMeshes = this.barBuilder.modules.map(m => m.mesh);
        const moduleIntersects = this.raycaster.intersectObjects(allMeshes, true);
        if (moduleIntersects.length > 0) {
            let hit = moduleIntersects[0].object;
            while (hit.parent && !hit.userData?.isBarModule) {
                hit = hit.parent;
            }
            const mod = this.barBuilder.modules.find(m => m.mesh === hit);
            if (mod) {
                this.barBuilder.selectModule(mod);
                this.activeSocketClickContext = null;
                this.showContextMenu(e.clientX, e.clientY, `Moduł: ${this.getModuleLabel(mod.modelKey)}`, [
                    { action: 'rotate', label: 'Obróć o 90° (R)', icon: '↻' },
                    { action: 'delete', label: 'Usuń moduł (Del)', icon: '✕' }
                ]);
                return;
            }
        }

        // 3. Kliknięcie PPM w siatkę / podłogę -> zapamiętaj pozycję 3D i otwórz menu wyboru modułu
        const intersectPoint = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.floorPlane, intersectPoint)) {
            const snap = 0.25;
            this.lastContextMenuFloorPos = new THREE.Vector3(
                Math.round(intersectPoint.x / snap) * snap,
                0,
                Math.round(intersectPoint.z / snap) * snap
            );
        } else {
            this.lastContextMenuFloorPos = new THREE.Vector3(0, 0, 0);
        }

        this.activeSocketClickContext = null;
        this.showContextMenu(e.clientX, e.clientY, 'Wstaw moduł na scenę', [
            { key: 'BAR_STRAIGHT',     label: 'Moduł prosty baru (1.5m)',        icon: '▮' },
            { key: 'BAR_CORNER',       label: 'Narożnik 90°',                    icon: '⌐' },
            { key: 'BACK_SHELF',       label: 'Regał zaplecza (1.5m)',           icon: '☲' },
            { key: 'BACK_FRIDGE',      label: 'Lodówka przeszklona 2D (1.0m)',   icon: '🗄' },
            { key: 'BACK_FRIDGE_SLIM', label: 'Lodówka przeszklona 1D (0.5m)',   icon: '🗄' }
        ]);
    }

    openSocketAttachMenu(clientX, clientY, parentModule, socketDef) {
        this.activeSocketClickContext = { parentModule, socketDef };

        // Filtruj opcje do dozwolonych dla tego gniazda (narożnik jest zunifikowany)
        const allOptions = [
            { key: 'BAR_STRAIGHT',     label: 'Dostaw prosty bar (1.5m)', icon: '▮' },
            { key: 'BAR_CORNER',       label: 'Dostaw narożnik 90°',      icon: '⌐' },
            { key: 'BACK_SHELF',       label: 'Dostaw regał zaplecza',    icon: '☲' },
            { key: 'BACK_FRIDGE',      label: 'Dostaw lodówkę 2D (1.0m)', icon: '🗄' },
            { key: 'BACK_FRIDGE_SLIM', label: 'Dostaw lodówkę 1D (0.5m)', icon: '🗄' }
        ];

        const filtered = allOptions.filter(opt => {
            if (opt.key === 'BAR_CORNER') {
                return socketDef.compatible.includes('BAR_CORNER') ||
                       socketDef.compatible.includes('BAR_CORNER_RIGHT') ||
                       socketDef.compatible.includes('BAR_CORNER_LEFT');
            }
            return socketDef.compatible.includes(opt.key);
        });

        this.showContextMenu(clientX, clientY, `Dołącz do: ${socketDef.label}`, filtered);
    }

    showContextMenu(x, y, title, items) {
        this.menuOpenedTime = performance.now();
        const menu = document.getElementById('context-menu');
        const titleElem = document.getElementById('context-menu-title');

        titleElem.textContent = title;
        menu.innerHTML = '';
        menu.appendChild(titleElem);

        items.forEach(item => {
            const row = document.createElement('div');
            row.className = 'popup-item';
            row.dataset.choice = item.key || item.action;
            row.innerHTML = `<span class="popup-item-icon">${item.icon}</span><span>${item.label}</span>`;
            
            row.addEventListener('pointerdown', (ev) => ev.stopPropagation());
            row.addEventListener('click', (ev) => {
                ev.stopPropagation();
                this.handleContextChoice(item);
                this.hideContextMenu();
            });
            menu.appendChild(row);
        });

        // Pozycja w oknie
        const menuW = 240;
        const menuH = 180;
        const posX = (x + menuW > window.innerWidth) ? window.innerWidth - menuW - 15 : x;
        const posY = (y + menuH > window.innerHeight) ? window.innerHeight - menuH - 15 : y;

        menu.style.left = `${posX}px`;
        menu.style.top = `${posY}px`;
        menu.style.display = 'flex';
    }

    hideContextMenu() {
        const menu = document.getElementById('context-menu');
        if (menu) menu.style.display = 'none';
        this.activeSocketClickContext = null;
    }

    handleContextChoice(item) {
        if (!item) return;

        if (item.action === 'rotate') {
            this.barBuilder.rotateSelected();
            return;
        }
        if (item.action === 'delete') {
            this.barBuilder.removeSelected();
            return;
        }

        const modelKey = item.key || item;

        if (this.activeSocketClickContext) {
            // Dołączenie do konkretnej kropki (gniazda)
            const { parentModule, socketDef } = this.activeSocketClickContext;
            const newMod = this.barBuilder.attachModuleToSocket(parentModule, socketDef, modelKey);
            this.showToast(`Dodano moduł z automatycznym spasowaniem.`);
        } else {
            // Uruchomienie trybu przyklejonego do kursora z automatycznym magnetycznym przyciąganiem do gniazd
            this.barBuilder.startGhost(modelKey);
            if (this.lastContextMenuFloorPos) {
                this.barBuilder.updateGhost(this.lastContextMenuFloorPos);
            }
            this.showToast(`Moduł przyklejony do kursora. Zbliż do złącza, aby przyciągnąć. LPM - postaw, R - obrót, PPM/ESC - anuluj.`);
        }
    }

    getModuleLabel(key) {
        switch (key) {
            case 'BAR_STRAIGHT':     return 'Bar Prosty';
            case 'BAR_CORNER':
            case 'BAR_CORNER_RIGHT':
            case 'BAR_CORNER_LEFT':  return 'Narożnik 90°';
            case 'BACK_SHELF':       return 'Regał Zaplecza';
            case 'BACK_FRIDGE':      return 'Lodówka 2-drzwiowa (1.0m)';
            case 'BACK_FRIDGE_SLIM': return 'Lodówka 1-drzwiowa (0.5m)';
            default: return key;
        }
    }

    initUI() {
        // Kalibrator offsetów (Admin Tool)
        const calibContainer = document.getElementById('calibration-container');
        this.calibrationTool = new CalibrationTool(this.registry, this.barBuilder, calibContainer);

        // Szybkie dodawanie modułów z dolnego paska
        document.getElementById('btn-add-straight')?.addEventListener('click', () => {
            this.barBuilder.startGhost('BAR_STRAIGHT');
            this.showToast('Wybrano Bar Prosty. Kliknij lewym przyciskiem myszy na siatce, aby go postawić. R - obrót, ESC - anuluj.');
        });
        document.getElementById('btn-add-corner')?.addEventListener('click', () => {
            this.barBuilder.startGhost('BAR_CORNER');
            this.showToast('Wybrano Narożnik 90°. Zbliż do złącza baru, aby dopasować stronę i kąt. R - obrót, ESC - anuluj.');
        });
        document.getElementById('btn-add-shelf')?.addEventListener('click', () => {
            this.barBuilder.startGhost('BACK_SHELF');
            this.showToast('Wybrano Regał zaplecza. Kliknij lewym przyciskiem myszy na siatce, aby go postawić. R - obrót, ESC - anuluj.');
        });
        document.getElementById('btn-add-fridge')?.addEventListener('click', () => {
            this.barBuilder.startGhost('BACK_FRIDGE');
            this.showToast('Wybrano Lodówkę przeszkloną 2D (1.0m). Kliknij lewym przyciskiem myszy na siatce, aby ją postawić. R - obrót, ESC - anuluj.');
        });
        document.getElementById('btn-add-fridge-slim')?.addEventListener('click', () => {
            this.barBuilder.startGhost('BACK_FRIDGE_SLIM');
            this.showToast('Wybrano Lodówkę przeszkloną 1D (0.5m). Kliknij lewym przyciskiem myszy na siatce, aby ją postawić. R - obrót, ESC - anuluj.');
        });

        // Przyciski widoków
        document.getElementById('btn-view-orbit').addEventListener('click', (e) => {
            this.setActiveViewBtn(e.target);
            this.animateCamera(new THREE.Vector3(0, 6.5, 9.5), new THREE.Vector3(0, 0.6, 0));
        });

        document.getElementById('btn-view-top').addEventListener('click', (e) => {
            this.setActiveViewBtn(e.target);
            this.animateCamera(new THREE.Vector3(0, 15, 0.001), new THREE.Vector3(0, 0, 0));
        });

        document.getElementById('btn-view-reset').addEventListener('click', () => {
            this.animateCamera(new THREE.Vector3(0, 6.5, 9.5), new THREE.Vector3(0, 0.6, 0));
        });

        document.getElementById('btn-rotate-module').addEventListener('click', () => {
            this.barBuilder.rotateSelected();
        });

        document.getElementById('btn-delete-module').addEventListener('click', () => {
            this.barBuilder.removeSelected();
            this.hideRadialMenu();
        });

        // Obsługa przycisków menu półradialnego nad obiektem 3D
        const radialMenuElem = document.getElementById('radial-action-menu');
        radialMenuElem?.addEventListener('pointerdown', (e) => e.stopPropagation());
        radialMenuElem?.addEventListener('click', (e) => e.stopPropagation());

        document.getElementById('radial-btn-rotate')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.barBuilder.rotateSelected();
            this.showToast('Obrócono moduł o 90°');
        });

        document.getElementById('radial-btn-move')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const picked = this.barBuilder.pickupModule();
            if (picked) {
                this.hideRadialMenu();
                this.showToast('Tryb przesuwania modułu. Zbliż do złącza, aby dociągnąć, lub postaw na siatce. ESC/PPM - powrót.');
            }
        });

        document.getElementById('radial-btn-delete')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.barBuilder.removeSelected();
            this.hideRadialMenu();
            this.showToast('Usunięto moduł.');
        });

        document.getElementById('btn-clear-scene').addEventListener('click', () => {
            if (confirm('Czy na pewno chcesz wyczyścić całą konfigurację baru?')) {
                this.barBuilder.clearScene();
                this.showToast('Wyczyszczono scenę.');
            }
        });

        // Zapis konfiguracji układu z bitmapą do pliku JSON
        document.getElementById('btn-save-project').addEventListener('click', () => {
            try {
                const projectData = this.barBuilder.exportProject(this.brandingManager.currentDataUrl);
                const jsonStr = JSON.stringify(projectData, null, 2);
                const blob = new Blob([jsonStr], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                
                const now = new Date();
                const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;
                const filename = `artbar-uklad-${timestamp}.json`;

                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                this.showToast(`Zapisano układ do pliku: ${filename}`);
            } catch (err) {
                console.error('Błąd zapisu projektu:', err);
                this.showToast('Wystąpił błąd podczas zapisu projektu.');
            }
        });

        // Wczytanie konfiguracji z pliku JSON
        const projectFileInput = document.getElementById('project-file-input');
        document.getElementById('btn-load-project').addEventListener('click', () => {
            projectFileInput.value = '';
            projectFileInput.click();
        });

        projectFileInput.addEventListener('change', (e) => {
            const file = e.target.files && e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = (event) => {
                try {
                    const projectData = JSON.parse(event.target.result);
                    const savedBitmap = this.barBuilder.importProject(projectData);

                    if (savedBitmap) {
                        this.brandingManager.loadGraphicFromDataUrl(savedBitmap, (dataUrl) => {
                            document.getElementById('branding-preview-img').src = dataUrl;
                            document.getElementById('branding-preview-box').style.display = 'flex';
                            const toggle = document.getElementById('branding-enable-toggle');
                            if (toggle) toggle.checked = true;
                            this.brandingManager.setEnabled(true);
                        });
                        this.showToast('Układ oraz wgrana grafika zostały pomyślnie wczytane!');
                    } else {
                        this.brandingManager.resetBranding();
                        const toggle = document.getElementById('branding-enable-toggle');
                        if (toggle) toggle.checked = false;
                        this.brandingManager.setEnabled(false);
                        document.getElementById('branding-preview-box').style.display = 'none';
                        this.showToast('Układ baru został pomyślnie wczytany!');
                    }
                } catch (err) {
                    console.error('Błąd wczytywania pliku projektu:', err);
                    alert('Nie udało się wczytać pliku. Upewnij się, że to poprawny plik konfiguracyjny Artbar (.json).');
                }
            };
            reader.readAsText(file);
        });

        // Panele boczne
        this.setupSidePanel('btn-open-presets', 'panel-presets');
        this.setupSidePanel('btn-open-branding', 'panel-branding');
        this.setupSidePanel('btn-open-scene-settings', 'panel-scene-settings');
        this.setupSidePanel('btn-open-calib', 'panel-calibration');
        this.setupSidePanel('btn-open-summary', 'panel-summary');

        // Presety
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', () => {
                const preset = card.dataset.preset;
                this.barBuilder.loadPreset(preset);
                this.showToast(`Załadowano preset: ${card.querySelector('.preset-name').textContent}`);
            });
        });

        // Branding Toggle Switch
        const brandingToggle = document.getElementById('branding-enable-toggle');
        brandingToggle?.addEventListener('change', (e) => {
            this.brandingManager.setEnabled(e.target.checked);
            if (e.target.checked) {
                this.showToast('Włączono branding / logo na barze prostym.');
            } else {
                this.showToast('Ukryto grafikę brandingu.');
            }
        });

        // Branding Upload
        const dropzone = document.getElementById('branding-dropzone');
        const fileInput = document.getElementById('branding-file-input');
        dropzone.addEventListener('click', () => fileInput.click());

        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handleBrandingFile(e.target.files[0]);
            }
        });

        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#FACB7D';
        });

        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = '';
        });

        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.handleBrandingFile(e.dataTransfer.files[0]);
            }
        });

        document.getElementById('btn-apply-branding').addEventListener('click', () => {
            const toggle = document.getElementById('branding-enable-toggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                this.brandingManager.setEnabled(true);
            }
            this.brandingManager.applyToAllFronts();
            this.showToast('Zastosowano grafikę do wszystkich frontów baru.');
        });

        document.getElementById('btn-reset-branding').addEventListener('click', () => {
            this.brandingManager.resetBranding();
            document.getElementById('branding-preview-box').style.display = 'none';
            this.showToast('Przywrócono domyślny wzór frontów.');
        });

        // Ustawienia Sceny (Tło, Światło, Kierunek)
        document.querySelectorAll('.color-chip').forEach(chip => {
            chip.addEventListener('click', () => {
                document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const col = chip.dataset.color;
                const customInput = document.getElementById('scene-bg-custom');
                if (customInput) customInput.value = col;
                this.setSceneBackgroundColor(col);
            });
        });

        const bgCustomInput = document.getElementById('scene-bg-custom');
        bgCustomInput?.addEventListener('input', (e) => {
            document.querySelectorAll('.color-chip').forEach(c => c.classList.remove('active'));
            this.setSceneBackgroundColor(e.target.value);
        });

        const lightMainSlider = document.getElementById('scene-light-main');
        const valLightMain = document.getElementById('val-light-main');
        lightMainSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valLightMain) valLightMain.textContent = val.toFixed(1);
            if (this.mainLight) this.mainLight.intensity = val;
        });

        const lightAmbientSlider = document.getElementById('scene-light-ambient');
        const valLightAmbient = document.getElementById('val-light-ambient');
        lightAmbientSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valLightAmbient) valLightAmbient.textContent = val.toFixed(1);
            if (this.ambientLight) this.ambientLight.intensity = val;
        });

        const lightAzimuthSlider = document.getElementById('scene-light-azimuth');
        const valLightAzimuth = document.getElementById('val-light-azimuth');
        lightAzimuthSlider?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.lightAzimuth = val;
            if (valLightAzimuth) valLightAzimuth.textContent = `${val}°`;
            this.updateMainLightPosition();
        });

        const lightElevationSlider = document.getElementById('scene-light-elevation');
        const valLightElevation = document.getElementById('val-light-elevation');
        lightElevationSlider?.addEventListener('input', (e) => {
            const val = parseInt(e.target.value, 10);
            this.lightElevation = val;
            if (valLightElevation) valLightElevation.textContent = `${val}°`;
            this.updateMainLightPosition();
        });

        // Drukuj zestawienie
        document.getElementById('btn-print-spec').addEventListener('click', () => {
            window.print();
        });
    }

    handleBrandingFile(file) {
        this.brandingManager.loadGraphicFromFile(file, (dataUrl) => {
            document.getElementById('branding-preview-img').src = dataUrl;
            document.getElementById('branding-preview-box').style.display = 'flex';
            const toggle = document.getElementById('branding-enable-toggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                this.brandingManager.setEnabled(true);
            }
            this.showToast('Wgrano grafikę i zaktualizowano fronty baru!');
        });
    }

    setupSidePanel(btnId, panelId) {
        const btn = document.getElementById(btnId);
        const panel = document.getElementById(panelId);
        const closeBtn = panel.querySelector('.panel-close-btn');

        btn.addEventListener('click', () => {
            const isCurrentlyOpen = panel.style.display === 'flex';
            // Zamknij inne panele
            document.querySelectorAll('.side-panel').forEach(p => p.style.display = 'none');
            document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));

            if (!isCurrentlyOpen) {
                panel.style.display = 'flex';
                btn.classList.add('active');
            }
        });

        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                panel.style.display = 'none';
                btn.classList.remove('active');
            });
        }
    }

    setActiveViewBtn(btn) {
        document.querySelectorAll('#btn-view-orbit, #btn-view-top').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }

    animateCamera(targetPos, targetLookAt) {
        const startPos = this.camera.position.clone();
        const startTarget = this.controls.target.clone();
        const duration = 600;
        const startTime = performance.now();

        const anim = (now) => {
            const elapsed = now - startTime;
            const progress = Math.min(elapsed / duration, 1.0);
            const ease = 0.5 - Math.cos(progress * Math.PI) / 2; // InOutQuad

            this.camera.position.lerpVectors(startPos, targetPos, ease);
            this.controls.target.lerpVectors(startTarget, targetLookAt, ease);
            this.controls.update();

            if (progress < 1.0) {
                requestAnimationFrame(anim);
            }
        };
        requestAnimationFrame(anim);
    }

    updateUIStats(stats) {
        // Pasek górny
        document.getElementById('stat-length').textContent = `${stats.totalFrontMeters.toFixed(1)} m`;
        document.getElementById('stat-straight').textContent = `${stats.BAR_STRAIGHT} szt.`;
        document.getElementById('stat-corners').textContent = `${stats.BAR_CORNER} szt.`;
        const totalFridges = (stats.BACK_FRIDGE || 0) + (stats.BACK_FRIDGE_SLIM || 0);
        document.getElementById('stat-backbar').textContent = `${stats.BACK_SHELF} / ${totalFridges}`;

        // Panel podsumowania
        document.getElementById('sum-straight').textContent = `${stats.BAR_STRAIGHT} szt.`;
        document.getElementById('sum-corners').textContent = `${stats.BAR_CORNER} szt.`;
        document.getElementById('sum-shelves').textContent = `${stats.BACK_SHELF} szt.`;
        document.getElementById('sum-fridges').textContent = `${stats.BACK_FRIDGE} szt.`;
        const sumFridgesSlim = document.getElementById('sum-fridges-slim');
        if (sumFridgesSlim) sumFridgesSlim.textContent = `${stats.BACK_FRIDGE_SLIM || 0} szt.`;
        document.getElementById('sum-total-length').textContent = `${stats.totalFrontMeters.toFixed(1)} m`;
    }

    showToast(message) {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        container.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 3200);
    }

    onResize() {
        this.camera.aspect = window.innerWidth / window.innerHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(window.innerWidth, window.innerHeight);
    }

    updateRadialMenuPosition() {
        const menu = document.getElementById('radial-action-menu');
        if (!menu) return;

        if (!this.barBuilder.selectedModule) {
            if (menu.classList.contains('visible')) {
                menu.classList.remove('visible');
            }
            return;
        }

        const anchor = this.barBuilder.getSelectedModuleAnchor();
        if (!anchor) {
            menu.classList.remove('visible');
            return;
        }

        const projected = anchor.clone().project(this.camera);

        // Jeśli punkt znajduje się za płaszczyzną kamery (niewidoczny), ukryj
        if (projected.z > 1.0) {
            menu.classList.remove('visible');
            return;
        }

        const screenX = (projected.x * 0.5 + 0.5) * window.innerWidth;
        const screenY = (-(projected.y * 0.5) + 0.5) * window.innerHeight;

        menu.style.left = `${screenX}px`;
        menu.style.top = `${screenY}px`;
        if (!menu.classList.contains('visible')) {
            menu.classList.add('visible');
        }
    }

    hideRadialMenu() {
        const menu = document.getElementById('radial-action-menu');
        if (menu) menu.classList.remove('visible');
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        this.controls.update();
        this.barBuilder.update(0.016);
        this.updateRadialMenuPosition();
        this.renderer.render(this.scene, this.camera);
    }
}

// Bezpieczne uruchomienie aplikacji (działa natychmiast, nawet jeśli DOMContentLoaded już minął)
function startApp() {
    if (!window.app) {
        console.log('[ARTBAR] Inicjalizacja ArtbarApp...');
        window.app = new ArtbarApp();
        window.showToast = (msg) => window.app.showToast(msg);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startApp);
} else {
    startApp();
}
