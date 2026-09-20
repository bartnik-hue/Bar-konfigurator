import * as THREE from 'three';
window.THREE = THREE;
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { ModelRegistry } from './ModelRegistry.js';
import { BarBuilder } from './BarBuilder.js';
import { BrandingManager } from './BrandingManager.js';
import { LedManager } from './LedManager.js';
import { CalibrationTool } from './CalibrationTool.js';
import { AiTextureService, AI_STYLE_PRESETS } from './AiTextureService.js';

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
        this.ledManager = new LedManager(this.barBuilder, this.registry);
        this.aiTextureService = new AiTextureService();

        // Automatyczne nakładanie bieżącego brandingu, tła i LED na nowo dodawane moduły
        this.barBuilder.onModuleAdded = (moduleData) => {
            if (this.brandingManager.currentTexture) {
                this.brandingManager.applyToModule(moduleData, this.brandingManager.currentTexture);
            }
            if (this.brandingManager.isBackgroundEnabled) {
                this.brandingManager.updateFrontPanoramas();
            }
            if (this.ledManager) {
                this.ledManager.applyToModule(moduleData);
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

        // Kamery: Perspektywiczna i Ortograficzna (Aksonometryczna / Ortho pod kątem)
        const aspect = window.innerWidth / window.innerHeight;
        this.perspCamera = new THREE.PerspectiveCamera(45, aspect, 0.1, 200);
        this.perspCamera.position.set(0, 6.5, 9.5);

        this.orthoFrustumSize = 8.5;
        this.orthoCamera = new THREE.OrthographicCamera(
            -this.orthoFrustumSize * aspect / 2,
            this.orthoFrustumSize * aspect / 2,
            this.orthoFrustumSize / 2,
            -this.orthoFrustumSize / 2,
            0.1,
            200
        );
        this.orthoCamera.position.set(10, 8.5, 10);
        this.orthoCamera.lookAt(0, 0.5, 0);

        this.camera = this.perspCamera;
        this.cameraMode = 'perspective';

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
        this.controls.minZoom = 0.25;
        this.controls.maxZoom = 4.0;
        this.controls.target.set(0, 0.6, 0);

        // Płaszczyzna raycastingu dla podłogi
        this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();

        // Resize handler
        window.addEventListener('resize', () => this.onResize());
    }

    setCameraMode(mode) {
        if (mode === 'orthographic') {
            this.cameraMode = 'orthographic';
            this.updateOrthoFrustum();
            this.orthoCamera.zoom = 1.0;
            this.camera = this.orthoCamera;
        } else {
            this.cameraMode = 'perspective';
            this.camera = this.perspCamera;
        }

        this.controls.object = this.camera;
        this.controls.update();

        if (this.barBuilder) {
            this.barBuilder.camera = this.camera;
        }
    }

    updateOrthoFrustum() {
        if (!this.orthoCamera) return;
        const aspect = window.innerWidth / window.innerHeight;
        this.orthoCamera.left = -this.orthoFrustumSize * aspect / 2;
        this.orthoCamera.right = this.orthoFrustumSize * aspect / 2;
        this.orthoCamera.top = this.orthoFrustumSize / 2;
        this.orthoCamera.bottom = -this.orthoFrustumSize / 2;
        this.orthoCamera.updateProjectionMatrix();
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
        // Elegancka studyjna posadzka z konfigurowalnym połyskiem
        const floorGeom = new THREE.PlaneGeometry(80, 80);
        const floorMat = new THREE.MeshStandardMaterial({
            color: 0x171717,
            roughness: 0.50,
            metalness: 0.20
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
            this.ledManager.applyToAll();
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
        this.pointerDownPos = { x: 0, y: 0, time: 0, pointerType: 'mouse' };
        this.menuOpenedTime = 0;
        this.longPressTimer = null;

        // Raycasting myszy i dotyku
        this.canvas.addEventListener('mousemove', (e) => this.onMouseMove(e));
        this.canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
        this.canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        this.canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
        this.canvas.addEventListener('pointercancel', (e) => this.onPointerCancel(e));
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
                this.hideRadialMenu();
            } else if (e.key === 'Escape') {
                const modalHelp = document.getElementById('modal-help');
                if (modalHelp && modalHelp.classList.contains('visible')) {
                    if (this.closeHelpModal) this.closeHelpModal();
                    return;
                }
                this.barBuilder.cancelGhost();
                this.barBuilder.deselectModule();
                this.hideContextMenu();
                this.hideRadialMenu();
            } else if ((e.key === 'k' || e.key === 'K') && (e.altKey || e.ctrlKey)) {
                // Ukryty skrót administratorski do kalibracji offsetów (Alt+K / Ctrl+K)
                e.preventDefault();
                document.getElementById('btn-open-calib')?.click();
            }
        });

        // Globalny dostęp do otwarcia kalibracji z konsoli w razie potrzeby
        window.toggleCalibration = () => {
            document.getElementById('btn-open-calib')?.click();
        };

        // Bezpieczne zamykanie menu przy kliknięciu poza menu (nie zamyka przy otwieraniu!)
        window.addEventListener('pointerdown', (e) => {
            if (performance.now() - this.menuOpenedTime < 350) return;
            if (!e.target.closest('#context-menu')) {
                this.hideContextMenu();
            }
        });
    }

    onMouseMove(e) {
        if (document.getElementById('modal-help')?.classList.contains('visible')) return;
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

    onPointerMove(e) {
        // Jeśli palec przemieścił się o więcej niż 12px, anuluj długie dotknięcie (użytkownik obraca kamerę)
        if (this.longPressTimer) {
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
            if (dist > 12) {
                clearTimeout(this.longPressTimer);
                this.longPressTimer = null;
            }
        }
        this.onMouseMove(e);
    }

    onPointerCancel(e) {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }
    }

    onPointerDown(e) {
        if (e.button !== 0 && e.pointerType !== 'touch') return;
        if (document.getElementById('modal-help')?.classList.contains('visible')) return;
        this.pointerDownPos = { x: e.clientX, y: e.clientY, time: performance.now(), pointerType: e.pointerType };

        // Obsługa długiego dotknięcia (Long Press) na urządzeniach dotykowych -> symulacja PPM (wstawienie modułu pod palec)
        if (e.pointerType === 'touch') {
            if (this.longPressTimer) clearTimeout(this.longPressTimer);
            if (!e.target.closest('.top-header') && !e.target.closest('.top-actions') && 
                !e.target.closest('.bottom-controls') && !e.target.closest('.side-panel') && 
                !e.target.closest('#context-menu') && !e.target.closest('#radial-action-menu') &&
                !e.target.closest('.modal-overlay')) {
                
                this.longPressTimer = setTimeout(() => {
                    this.onContextMenu(e);
                    if (navigator.vibrate) navigator.vibrate(35);
                }, 520);
            }
        }
    }

    onPointerUp(e) {
        if (this.longPressTimer) {
            clearTimeout(this.longPressTimer);
            this.longPressTimer = null;
        }

        // Tylko LPM (przycisk 0) lub dotyk
        if (e.button !== 0 && e.pointerType !== 'touch') return;

        // Jeśli modal pomocy jest otwarty, ignoruj interakcje ze sceną
        if (document.getElementById('modal-help')?.classList.contains('visible')) return;

        // Jeśli kliknięto w elementy UI, ignoruj
        if (e.target.closest('.top-header') || e.target.closest('.top-actions') || 
            e.target.closest('.bottom-controls') || e.target.closest('.side-panel') || 
            e.target.closest('#context-menu') || e.target.closest('#radial-action-menu') ||
            e.target.closest('.modal-overlay')) {
            return;
        }

        // Sprawdź czy to było kliknięcie czy przeciąganie kamery
        // Na ekranach dotykowych palec ma naturalny mikro-ruch przy tapnięciu, dlatego próg wynosi 22px
        const threshold = (e.pointerType === 'touch' || this.pointerDownPos.pointerType === 'touch') ? 22 : 8;
        const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
        if (dist > threshold) {
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

        // Jeśli modal pomocy jest otwarty, ignoruj
        if (document.getElementById('modal-help')?.classList.contains('visible')) return;

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

        // Pozycja w oknie - zabezpieczenie przed wyjściem poza ekran na smartfonach i tabletach
        const menuW = Math.min(240, window.innerWidth - 20);
        const menuH = 220;
        const posX = Math.max(10, Math.min(window.innerWidth - menuW - 10, x));
        const posY = Math.max(10, Math.min(window.innerHeight - menuH - 10, y));

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
        // Dostosowanie dymka podpowiedzi dla ekranów dotykowych
        if ('ontouchstart' in window || navigator.maxTouchPoints > 0) {
            const hint = document.querySelector('.canvas-hint');
            if (hint) {
                hint.innerHTML = `
                    <strong>Dotknij moduł:</strong> zaznacz i obróć &bull; 
                    <strong>Dotknij złotej kropki:</strong> dołącz moduł &bull; 
                    <strong>Przytrzymaj palec na siatce:</strong> wstaw moduł
                `;
            }
        }

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
        document.getElementById('btn-view-orbit')?.addEventListener('click', (e) => {
            this.setActiveViewBtn(e.currentTarget);
            this.setCameraMode('perspective');
            this.animateCamera(new THREE.Vector3(0, 6.5, 9.5), new THREE.Vector3(0, 0.6, 0));
        });

        document.getElementById('btn-view-top')?.addEventListener('click', (e) => {
            this.setActiveViewBtn(e.currentTarget);
            this.setCameraMode('perspective');
            this.animateCamera(new THREE.Vector3(0, 15, 0.001), new THREE.Vector3(0, 0, 0));
        });

        document.getElementById('btn-view-ortho')?.addEventListener('click', (e) => {
            this.setActiveViewBtn(e.currentTarget);
            this.setCameraMode('orthographic');
            // Kąt aksonometryczny pod kątem 45°
            this.animateCamera(new THREE.Vector3(10, 8.5, 10), new THREE.Vector3(0, 0.5, 0));
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

        document.getElementById('radial-btn-move-all')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const picked = this.barBuilder.pickupGroup();
            if (picked) {
                this.hideRadialMenu();
                const count = picked.modules ? picked.modules.length : 1;
                this.showToast(`Przesuwanie całego modułu (${count} el.). R - obrót, LPM - postaw, ESC/PPM - powrót.`);
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
                const brandingSettings = this.brandingManager.getSettings();
                const ledSettings = this.ledManager.getSettings();
                const projectData = this.barBuilder.exportProject(
                    this.brandingManager.currentDataUrl,
                    brandingSettings,
                    ledSettings
                );
                projectData.floorSettings = {
                    roughness: this.floorMesh?.material?.roughness ?? 0.50,
                    metalness: this.floorMesh?.material?.metalness ?? 0.20
                };
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
                    const imported = this.barBuilder.importProject(projectData);
                    const savedBitmap = (typeof imported === 'string') ? imported : imported?.brandingDataUrl;
                    const savedSettings = (typeof imported === 'object') ? imported?.brandingSettings : null;
                    const savedLedSettings = (typeof imported === 'object') ? imported?.ledSettings : null;

                    if (savedSettings) {
                        this.brandingManager.applySettings(savedSettings);
                        if (savedSettings.background && savedSettings.background.aiMetadata && savedSettings.background.url) {
                            this.restoreAiGeneratorFromProject(savedSettings.background.aiMetadata, savedSettings.background.url);
                        }
                    }

                    if (savedLedSettings) {
                        this.ledManager.applySettings(savedLedSettings);
                    }

                    if (projectData.floorSettings) {
                        const r = projectData.floorSettings.roughness;
                        const m = projectData.floorSettings.metalness;
                        if (r !== undefined && this.floorMesh?.material) {
                            this.floorMesh.material.roughness = r;
                            const slider = document.getElementById('slider-floor-roughness');
                            if (slider) slider.value = r;
                            const valLabel = document.getElementById('val-floor-roughness');
                            if (valLabel) {
                                let desc = (r < 0.25) ? ' (Wysoki połysk)' : (r < 0.6 ? ' (Półmat)' : ' (Matowa)');
                                valLabel.textContent = `${r.toFixed(2)}${desc}`;
                            }
                        }
                        if (m !== undefined && this.floorMesh?.material) {
                            this.floorMesh.material.metalness = m;
                            const slider = document.getElementById('slider-floor-metalness');
                            if (slider) slider.value = m;
                            const valLabel = document.getElementById('val-floor-metalness');
                            if (valLabel) valLabel.textContent = m.toFixed(2);
                        }
                    }

                    if (savedBitmap) {
                        this.brandingManager.loadGraphicFromDataUrl(savedBitmap, (dataUrl) => {
                            document.getElementById('branding-preview-img').src = dataUrl;
                            document.getElementById('branding-preview-box').style.display = 'flex';
                            document.getElementById('branding-adjust-controls').style.display = 'block';
                            const toggle = document.getElementById('branding-enable-toggle');
                            if (toggle) toggle.checked = true;
                            this.brandingManager.setEnabled(true);
                        });
                    } else {
                        this.brandingManager.resetBranding();
                        const toggle = document.getElementById('branding-enable-toggle');
                        if (toggle) toggle.checked = false;
                        this.brandingManager.setEnabled(false);
                        document.getElementById('branding-preview-box').style.display = 'none';
                        document.getElementById('branding-adjust-controls').style.display = 'none';
                    }
                    this.showToast('Układ baru oraz grafiki zostały wczytane!');
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
        this.setupSidePanel('btn-open-led', 'panel-led');
        this.setupSidePanel('btn-open-scene-settings', 'panel-scene-settings');
        this.setupSidePanel('btn-open-calib', 'panel-calibration');
        this.setupSidePanel('btn-open-summary', 'panel-summary');

        // Modal pomocy i instrukcji
        this.setupHelpModal();

        // Presety gotowych układów baru
        document.querySelectorAll('.preset-card').forEach(card => {
            card.addEventListener('click', () => {
                const preset = card.dataset.preset;
                this.barBuilder.loadPreset(preset);
                this.showToast(`Załadowano preset: ${card.querySelector('.preset-name').textContent}`);
            });
        });

        // ==========================================
        // TŁO PANORAMICZNE (materiał 'front')
        // ==========================================
        const togglePanorama = document.getElementById('toggle-panorama-enable');
        togglePanorama?.addEventListener('change', (e) => {
            this.brandingManager.setBackgroundEnabled(e.target.checked);
            if (e.target.checked) {
                this.showToast('Włączono tło panoramiczne na frontach baru.');
            } else {
                this.showToast('Wyłączono tło panoramiczne na frontach.');
            }
        });

        // Wybór trybu mapowania (ciągły pas vs powtarzanie modułu)
        const btnModeChain = document.getElementById('btn-mode-chain');
        const btnModeRepeat = document.getElementById('btn-mode-repeat');
        const sliderPanoSpan = document.getElementById('slider-panorama-span');
        const valPanoSpan = document.getElementById('val-panorama-span');
        const rowPanoSpan = document.getElementById('row-panorama-span');

        btnModeChain?.addEventListener('click', () => {
            btnModeChain.classList.add('active');
            btnModeRepeat?.classList.remove('active');
            if (rowPanoSpan) rowPanoSpan.style.display = 'flex';
            this.brandingManager.setBackgroundMode('chain');
            this.showToast('Tryb tła: Ciągły pas (płynna panorama na całym ciągu baru).');
        });

        btnModeRepeat?.addEventListener('click', () => {
            btnModeRepeat.classList.add('active');
            btnModeChain?.classList.remove('active');
            if (rowPanoSpan) rowPanoSpan.style.display = 'none';
            this.brandingManager.setBackgroundMode('repeat');
            this.showToast('Tryb tła: Powtarzaj pełną grafikę na każdym module.');
        });

        sliderPanoSpan?.addEventListener('input', (e) => {
            const span = parseInt(e.target.value, 10);
            if (valPanoSpan) valPanoSpan.textContent = `${span} barów (${(span * 1.5).toFixed(1)} m)`;
            this.brandingManager.setBackgroundSpan(span);
        });

        // Wybór z gotowych wzorów (karty miniatur)
        const presetCards = document.querySelectorAll('.panorama-card');
        presetCards.forEach(card => {
            card.addEventListener('click', () => {
                const presetId = card.dataset.preset;
                presetCards.forEach(c => c.classList.remove('active'));
                card.classList.add('active');

                if (togglePanorama && !togglePanorama.checked) {
                    togglePanorama.checked = true;
                }

                this.brandingManager.setBackgroundPreset(presetId, () => {
                    const title = card.querySelector('.panorama-title')?.textContent || presetId;
                    this.showToast(`Zastosowano tło panoramiczne: ${title}`);
                });
            });
        });

        // Wgranie własnego pliku tła panoramicznego
        const panoDropzone = document.getElementById('panorama-dropzone');
        const panoFileInput = document.getElementById('panorama-file-input');
        panoDropzone?.addEventListener('click', () => panoFileInput?.click());

        panoFileInput?.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                this.handlePanoramaFile(e.target.files[0]);
            }
        });

        panoDropzone?.addEventListener('dragover', (e) => {
            e.preventDefault();
            panoDropzone.style.borderColor = '#FACB7D';
        });
        panoDropzone?.addEventListener('dragleave', () => {
            panoDropzone.style.borderColor = '';
        });
        panoDropzone?.addEventListener('drop', (e) => {
            e.preventDefault();
            panoDropzone.style.borderColor = '';
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                this.handlePanoramaFile(e.dataTransfer.files[0]);
            }
        });

        // Reset tła panoramicznego do domyślnego materiału
        document.getElementById('btn-reset-panorama')?.addEventListener('click', () => {
            this.brandingManager.resetBackgroundGraphic();
            if (togglePanorama) togglePanorama.checked = false;
            presetCards.forEach(c => c.classList.remove('active'));
            this.showToast('Przywrócono domyślny materiał frontów baru.');
        });

        // Synchronizacja UI przy zmianie stanu tła
        this.brandingManager.onBackgroundChanged = (bg) => {
            if (togglePanorama) togglePanorama.checked = bg.enabled;
            presetCards.forEach(c => {
                c.classList.toggle('active', c.dataset.preset === bg.presetId);
            });
            if (bg.mode === 'chain') {
                btnModeChain?.classList.add('active');
                btnModeRepeat?.classList.remove('active');
                if (rowPanoSpan) rowPanoSpan.style.display = 'flex';
            } else {
                btnModeRepeat?.classList.add('active');
                btnModeChain?.classList.remove('active');
                if (rowPanoSpan) rowPanoSpan.style.display = 'none';
            }
            if (sliderPanoSpan && bg.spanModules) {
                sliderPanoSpan.value = bg.spanModules;
                if (valPanoSpan) valPanoSpan.textContent = `${bg.spanModules} barów (${(bg.spanModules * 1.5).toFixed(1)} m)`;
            }
        };

        // Inicjalizacja Generatora Tła AI (Stable Diffusion)
        this.setupAiGenerator();

        // ==========================================
        // LOGOTYP / BRANDING NAKŁADKOWY
        // ==========================================
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
            const adjustControls = document.getElementById('branding-adjust-controls');
            if (adjustControls) adjustControls.style.display = 'none';
            this.showToast('Przywrócono domyślny wzór frontów.');
        });

        // Kontrolki dopasowania i skali brandingu
        const sliderScale = document.getElementById('slider-branding-scale');
        const valScale = document.getElementById('val-branding-scale');
        const sliderWidth = document.getElementById('slider-branding-width');
        const valWidth = document.getElementById('val-branding-width');
        const sliderHeight = document.getElementById('slider-branding-height');
        const valHeight = document.getElementById('val-branding-height');
        const sliderPosY = document.getElementById('slider-branding-posy');
        const valPosY = document.getElementById('val-branding-posy');
        const toggleLockAspect = document.getElementById('toggle-branding-lock-aspect');
        const btnAutoAspect = document.getElementById('btn-auto-aspect');

        // Callback synchronizacji suwaków z modelem danych
        this.brandingManager.onDimensionsChanged = (dims) => {
            if (sliderScale && valScale) {
                sliderScale.value = dims.scale;
                valScale.textContent = `${dims.scale}%`;
            }
            if (sliderWidth && valWidth) {
                sliderWidth.value = dims.width.toFixed(2);
                valWidth.textContent = `${dims.width.toFixed(2)} m`;
            }
            if (sliderHeight && valHeight) {
                sliderHeight.value = dims.height.toFixed(2);
                valHeight.textContent = `${dims.height.toFixed(2)} m`;
            }
            if (sliderPosY && valPosY) {
                sliderPosY.value = dims.offsetY.toFixed(2);
                valPosY.textContent = `${dims.offsetY.toFixed(2)} m`;
            }
            if (toggleLockAspect) {
                toggleLockAspect.checked = dims.lockAspect;
            }
        };

        sliderScale?.addEventListener('input', (e) => {
            this.brandingManager.setScale(parseFloat(e.target.value));
        });

        sliderWidth?.addEventListener('input', (e) => {
            this.brandingManager.setWidth(parseFloat(e.target.value));
        });

        sliderHeight?.addEventListener('input', (e) => {
            this.brandingManager.setHeight(parseFloat(e.target.value));
        });

        sliderPosY?.addEventListener('input', (e) => {
            this.brandingManager.setOffsetY(parseFloat(e.target.value));
        });

        toggleLockAspect?.addEventListener('change', (e) => {
            this.brandingManager.setLockAspect(e.target.checked);
        });

        btnAutoAspect?.addEventListener('click', () => {
            this.brandingManager.resetAspect();
            this.showToast('Dopasowano rozmiar do oryginalnych proporcji pliku graficznego.');
        });

        // ==========================================
        // USTAWIENIA LED
        // ==========================================
        const ledToggle = document.getElementById('led-enable-toggle');
        ledToggle?.addEventListener('change', (e) => {
            this.ledManager.setEnabled(e.target.checked);
            this.showToast(e.target.checked ? 'Włączono podświetlenie LED.' : 'Wyłączono podświetlenie LED.');
        });

        const ledChips = document.querySelectorAll('#panel-led .led-chip');
        const ledCustomInput = document.getElementById('led-color-custom');
        ledChips.forEach(chip => {
            chip.addEventListener('click', () => {
                ledChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const col = chip.dataset.color;
                if (ledCustomInput) ledCustomInput.value = col;
                this.ledManager.setColor(col);
            });
        });

        ledCustomInput?.addEventListener('input', (e) => {
            ledChips.forEach(c => c.classList.remove('active'));
            this.ledManager.setColor(e.target.value);
        });

        const ledSlider = document.getElementById('slider-led-intensity');
        const valLedIntensity = document.getElementById('val-led-intensity');
        ledSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (valLedIntensity) valLedIntensity.textContent = val.toFixed(1);
            this.ledManager.setIntensity(val);
        });

        // Wygląd elementów LED po wyłączeniu (niewidoczne vs czarny profil)
        const btnLedOffInvisible = document.getElementById('btn-led-off-invisible');
        const btnLedOffBlack = document.getElementById('btn-led-off-black');

        btnLedOffInvisible?.addEventListener('click', () => {
            btnLedOffInvisible.classList.add('active');
            btnLedOffBlack?.classList.remove('active');
            this.ledManager.setOffAppearance('invisible');
            this.showToast('Gdy LED wyłączony: elementy są niewidoczne.');
        });

        btnLedOffBlack?.addEventListener('click', () => {
            btnLedOffBlack.classList.add('active');
            btnLedOffInvisible?.classList.remove('active');
            this.ledManager.setOffAppearance('black');
            this.showToast('Gdy LED wyłączony: czarny profil matowy.');
        });

        // Synchronizacja UI przy zmianie ustawień LED (np. po wczytaniu projektu)
        this.ledManager.onLedChanged = (settings) => {
            if (ledToggle) ledToggle.checked = !!settings.enabled;
            if (valLedIntensity) valLedIntensity.textContent = Number(settings.intensity).toFixed(1);
            if (ledSlider) ledSlider.value = settings.intensity;
            if (ledCustomInput) ledCustomInput.value = settings.color;

            if (settings.offAppearance === 'black') {
                btnLedOffBlack?.classList.add('active');
                btnLedOffInvisible?.classList.remove('active');
            } else {
                btnLedOffInvisible?.classList.add('active');
                btnLedOffBlack?.classList.remove('active');
            }

            ledChips.forEach(chip => {
                if ((chip.dataset.color || '').toLowerCase() === (settings.color || '').toLowerCase()) {
                    chip.classList.add('active');
                } else {
                    chip.classList.remove('active');
                }
            });
        };

        // Ustawienia Sceny (Tło, Światło, Kierunek)
        const sceneColorChips = document.querySelectorAll('#panel-scene-settings .color-chip');
        const bgCustomInput = document.getElementById('scene-bg-custom');

        sceneColorChips.forEach(chip => {
            chip.addEventListener('click', () => {
                sceneColorChips.forEach(c => c.classList.remove('active'));
                chip.classList.add('active');
                const col = chip.dataset.color;
                if (bgCustomInput) bgCustomInput.value = col;
                this.setSceneBackgroundColor(col);
            });
        });

        bgCustomInput?.addEventListener('input', (e) => {
            sceneColorChips.forEach(c => c.classList.remove('active'));
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

        // Właściwości materiału podłogi (Połysk / Chropowatość i Refleksyjność)
        const floorRoughnessSlider = document.getElementById('slider-floor-roughness');
        const valFloorRoughness = document.getElementById('val-floor-roughness');
        floorRoughnessSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (this.floorMesh?.material) {
                this.floorMesh.material.roughness = val;
                this.floorMesh.material.needsUpdate = true;
            }
            if (valFloorRoughness) {
                let desc = '';
                if (val < 0.25) desc = ' (Wysoki połysk)';
                else if (val < 0.6) desc = ' (Półmat)';
                else desc = ' (Matowa)';
                valFloorRoughness.textContent = `${val.toFixed(2)}${desc}`;
            }
        });

        const floorMetalnessSlider = document.getElementById('slider-floor-metalness');
        const valFloorMetalness = document.getElementById('val-floor-metalness');
        floorMetalnessSlider?.addEventListener('input', (e) => {
            const val = parseFloat(e.target.value);
            if (this.floorMesh?.material) {
                this.floorMesh.material.metalness = val;
                this.floorMesh.material.needsUpdate = true;
            }
            if (valFloorMetalness) {
                valFloorMetalness.textContent = val.toFixed(2);
            }
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
            const adjustControls = document.getElementById('branding-adjust-controls');
            if (adjustControls) adjustControls.style.display = 'block';
            const toggle = document.getElementById('branding-enable-toggle');
            if (toggle && !toggle.checked) {
                toggle.checked = true;
                this.brandingManager.setEnabled(true);
            }
            this.showToast('Wgrano grafikę logo i zaktualizowano fronty baru!');
        });
    }

    handlePanoramaFile(file) {
        this.brandingManager.loadBackgroundFromFile(file, () => {
            const toggle = document.getElementById('toggle-panorama-enable');
            if (toggle && !toggle.checked) toggle.checked = true;
            document.querySelectorAll('.panorama-card').forEach(c => c.classList.remove('active'));
            this.showToast('Wgrano własną grafikę na fronty baru!');
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
                // Zamknij modal pomocy jeśli był otwarty
                document.getElementById('modal-help')?.classList.remove('visible');
                document.getElementById('btn-open-help')?.classList.remove('active');

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

    setupHelpModal() {
        const modalHelp = document.getElementById('modal-help');
        const btnOpen = document.getElementById('btn-open-help');
        const btnClose = document.getElementById('btn-close-help');
        const btnDismiss = document.getElementById('btn-help-dismiss');
        const chkDontShow = document.getElementById('chk-dont-show-help');

        if (!modalHelp) return;

        this.openHelpModal = () => {
            // Zamknij ewentualnie otwarte panele boczne
            document.querySelectorAll('.side-panel').forEach(p => p.style.display = 'none');
            document.querySelectorAll('.btn-tool').forEach(b => b.classList.remove('active'));
            btnOpen?.classList.add('active');

            const hasSeen = localStorage.getItem('artbar_has_seen_help') === '1';
            if (chkDontShow) chkDontShow.checked = hasSeen;
            modalHelp.classList.add('visible');
        };

        this.closeHelpModal = () => {
            if (chkDontShow && chkDontShow.checked) {
                localStorage.setItem('artbar_has_seen_help', '1');
            } else {
                localStorage.removeItem('artbar_has_seen_help');
            }
            modalHelp.classList.remove('visible');
            btnOpen?.classList.remove('active');
        };

        btnOpen?.addEventListener('click', () => {
            if (modalHelp.classList.contains('visible')) {
                this.closeHelpModal();
            } else {
                this.openHelpModal();
            }
        });

        btnClose?.addEventListener('click', () => {
            this.closeHelpModal();
        });

        btnDismiss?.addEventListener('click', () => {
            this.closeHelpModal();
        });

        // Kliknięcie w tło modala (poza oknem) zamyka okno
        modalHelp.addEventListener('click', (e) => {
            if (e.target === modalHelp) {
                this.closeHelpModal();
            }
        });

        // Sprawdzenie pierwszego wejścia do konfiguratora
        const hasSeenHelp = localStorage.getItem('artbar_has_seen_help');
        if (!hasSeenHelp) {
            // Pierwsze wejście: otwórz okno pomocy z zaznaczonym domyślnie checkboxem "Nie pokazuj przy uruchomieniu"
            if (chkDontShow) chkDontShow.checked = true;
            modalHelp.classList.add('visible');
            btnOpen?.classList.add('active');
        }
    }

    setActiveViewBtn(btn) {
        document.querySelectorAll('#btn-view-orbit, #btn-view-top, #btn-view-ortho').forEach(b => b.classList.remove('active'));
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
        // Panel podsumowania
        const sumStraight = document.getElementById('sum-straight');
        if (sumStraight) sumStraight.textContent = `${stats.BAR_STRAIGHT} szt.`;

        const sumCorners = document.getElementById('sum-corners');
        if (sumCorners) sumCorners.textContent = `${stats.BAR_CORNER} szt.`;

        const sumShelves = document.getElementById('sum-shelves');
        if (sumShelves) sumShelves.textContent = `${stats.BACK_SHELF} szt.`;

        const sumFridges = document.getElementById('sum-fridges');
        if (sumFridges) sumFridges.textContent = `${stats.BACK_FRIDGE} szt.`;

        const sumFridgesSlim = document.getElementById('sum-fridges-slim');
        if (sumFridgesSlim) sumFridgesSlim.textContent = `${stats.BACK_FRIDGE_SLIM || 0} szt.`;

        const sumTotalLength = document.getElementById('sum-total-length');
        if (sumTotalLength) sumTotalLength.textContent = `${stats.totalFrontMeters.toFixed(1)} m`;

        // Automatycznie zaktualizuj podział panoramy na ciągach barów po każdej zmianie na scenie
        if (this.brandingManager && this.brandingManager.isBackgroundEnabled) {
            this.brandingManager.updateFrontPanoramas();
        }
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
        const aspect = window.innerWidth / window.innerHeight;
        this.perspCamera.aspect = aspect;
        this.perspCamera.updateProjectionMatrix();
        this.updateOrthoFrustum();
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

        const rawX = (projected.x * 0.5 + 0.5) * window.innerWidth;
        const rawY = (-(projected.y * 0.5) + 0.5) * window.innerHeight;

        // Marginesy ekranowe dostosowane do rozmiaru wyświetlacza (smartfon vs desktop)
        const isMobile = window.innerWidth <= 768;
        const marginX = isMobile ? 84 : 105;
        const marginTop = isMobile ? 120 : 100;
        const marginBottom = isMobile ? 75 : 85;

        const screenX = Math.max(marginX, Math.min(window.innerWidth - marginX, rawX));
        const screenY = Math.max(marginTop, Math.min(window.innerHeight - marginBottom, rawY));

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

    setupAiGenerator() {
        const stylesContainer = document.getElementById('ai-styles-container');
        const promptInput = document.getElementById('ai-prompt-input');
        const btnGenerate = document.getElementById('btn-ai-generate');
        const btnGenerateTxt = document.getElementById('ai-generate-btn-text');
        const progressBox = document.getElementById('ai-progress-box');
        const progressFill = document.getElementById('ai-progress-fill');
        const progressStatus = document.getElementById('ai-progress-status');

        const previewBox = document.getElementById('ai-preview-box');
        const previewImg = document.getElementById('ai-preview-img');
        const btnApply = document.getElementById('btn-ai-apply');
        const btnReroll = document.getElementById('btn-ai-reroll');
        const btnDownload = document.getElementById('btn-ai-download');

        const historySection = document.getElementById('ai-history-section');
        const historyContainer = document.getElementById('ai-history-container');

        const btnToggleSettings = document.getElementById('btn-ai-toggle-settings');
        const settingsPanel = document.getElementById('ai-settings-panel');
        const selectProvider = document.getElementById('ai-select-provider');
        
        // ComfyUI elementy
        const rowComfyUrl = document.getElementById('ai-row-comfy-url');
        const inputComfyUrl = document.getElementById('ai-input-comfy-url');
        const rowComfyCkpt = document.getElementById('ai-row-comfy-ckpt');
        const selectComfyCkpt = document.getElementById('ai-select-comfy-ckpt');

        // Chmura i SD WebUI
        const rowCloudKey = document.getElementById('ai-row-cloud-key');
        const inputApiKey = document.getElementById('ai-input-api-key');
        const rowLocalUrl = document.getElementById('ai-row-local-url');
        const inputLocalUrl = document.getElementById('ai-input-local-url');
        
        const toggleSeamless = document.getElementById('ai-toggle-seamless');
        const selectAspect = document.getElementById('ai-select-aspect');

        const updateProviderRows = (prov) => {
            if (rowComfyUrl) rowComfyUrl.style.display = prov === 'comfyui' ? 'flex' : 'none';
            if (rowComfyCkpt) rowComfyCkpt.style.display = prov === 'comfyui' ? 'flex' : 'none';
            if (rowCloudKey) rowCloudKey.style.display = prov === 'cloud' ? 'flex' : 'none';
            if (rowLocalUrl) rowLocalUrl.style.display = prov === 'automatic1111' ? 'flex' : 'none';
        };

        const statusBadge = document.getElementById('ai-comfy-status-badge');
        const btnRefreshComfy = document.getElementById('ai-btn-refresh-comfy');

        const updateComfyStatusUI = async () => {
            if (statusBadge) {
                statusBadge.className = 'ai-comfy-badge';
                statusBadge.textContent = '🔄 Wykrywanie instancji ComfyUI...';
            }
            const info = await this.aiTextureService.checkComfyUiConnection();
            if (info.ok) {
                if (statusBadge) {
                    statusBadge.className = 'ai-comfy-badge connected';
                    const devName = info.devices?.[0]?.name ? info.devices[0].name.replace(/^cuda:\d+\s*/, '').split(':')[0].trim() : 'GPU';
                    statusBadge.textContent = `🟢 Połączono: ${info.type} (port ${info.port}) • ${devName}`;
                }
                if (inputComfyUrl) inputComfyUrl.value = this.aiTextureService.comfyUiUrl;
            } else {
                if (statusBadge) {
                    statusBadge.className = 'ai-comfy-badge disconnected';
                    statusBadge.textContent = `🔴 ComfyUI nie odpowiada (sprawdź czy aplikacja jest włączona)`;
                }
            }
            await loadComfyCheckpoints();
        };

        const loadComfyCheckpoints = async () => {
            if (!selectComfyCkpt) return;
            selectComfyCkpt.innerHTML = '<option value="">(Wyszukiwanie modeli na ComfyUI...)</option>';
            const models = await this.aiTextureService.fetchComfyUiCheckpoints();
            if (models && models.length > 0) {
                selectComfyCkpt.innerHTML = '';
                models.forEach(item => {
                    const name = typeof item === 'object' ? item.name : item;
                    const label = typeof item === 'object' ? item.label : item;
                    const opt = document.createElement('option');
                    opt.value = name;
                    opt.textContent = label;
                    if (name === this.aiTextureService.comfyUiCheckpoint) opt.selected = true;
                    selectComfyCkpt.appendChild(opt);
                });
            } else {
                selectComfyCkpt.innerHTML = '<option value="">(Brak modeli - umieść model w models/checkpoints)</option>';
            }
        };

        btnRefreshComfy?.addEventListener('click', (e) => {
            e.preventDefault();
            updateComfyStatusUI();
        });

        // Inicjalizacja pól ustawień z AiTextureService
        if (selectProvider) {
            selectProvider.value = this.aiTextureService.provider;
            updateProviderRows(this.aiTextureService.provider);
            if (this.aiTextureService.provider === 'comfyui') {
                updateComfyStatusUI();
            }
        }
        if (inputComfyUrl) inputComfyUrl.value = this.aiTextureService.comfyUiUrl;
        if (inputApiKey) inputApiKey.value = this.aiTextureService.stabilityApiKey;
        if (inputLocalUrl) inputLocalUrl.value = this.aiTextureService.localWebUiUrl;
        if (toggleSeamless) toggleSeamless.checked = this.aiTextureService.isSeamless;
        if (selectAspect) selectAspect.value = this.aiTextureService.aspectRatioId;

        // Renderowanie kafelków stylów architektonicznych
        if (stylesContainer) {
            stylesContainer.innerHTML = '';
            AI_STYLE_PRESETS.forEach(style => {
                const card = document.createElement('div');
                card.className = `ai-style-card ${style.id === this.aiTextureService.activeStyleId ? 'active' : ''}`;
                card.dataset.styleId = style.id;
                card.title = `${style.desc}`;
                card.innerHTML = `
                    <div class="ai-style-icon">${style.icon}</div>
                    <div class="ai-style-name">${style.name}</div>
                `;
                card.addEventListener('click', () => {
                    stylesContainer.querySelectorAll('.ai-style-card').forEach(c => c.classList.remove('active'));
                    card.classList.add('active');
                    this.aiTextureService.setStyle(style.id);
                });
                stylesContainer.appendChild(card);
            });
        }

        // Przełączanie widoczności panelu ustawień silnika
        btnToggleSettings?.addEventListener('click', () => {
            const isOpen = settingsPanel.style.display === 'flex';
            settingsPanel.style.display = isOpen ? 'none' : 'flex';
            btnToggleSettings.classList.toggle('active', !isOpen);
            if (!isOpen && this.aiTextureService.provider === 'comfyui') {
                updateComfyStatusUI();
            }
        });

        // Zmiana dostawcy (ComfyUI / Cloud / Automatic1111 / Demo)
        selectProvider?.addEventListener('change', (e) => {
            const prov = e.target.value;
            this.aiTextureService.setProvider(prov);
            updateProviderRows(prov);

            if (prov === 'comfyui') {
                updateComfyStatusUI();
                this.showToast('Wybrano lokalne ComfyUI (GPU).');
            } else if (prov === 'cloud') {
                this.showToast('Wybrano chmurę Stability AI (SDXL). Wprowadź klucz API.');
            } else if (prov === 'automatic1111') {
                this.showToast('Wybrano lokalne WebUI AUTOMATIC1111 (http://127.0.0.1:7860).');
            } else {
                this.showToast('Wybrano szybki tryb demonstracyjny (nie wymaga kluczy ani GPU).');
            }
        });

        // Zapis wartości konfiguracyjnych
        inputComfyUrl?.addEventListener('input', (e) => {
            this.aiTextureService.setComfyUiUrl(e.target.value);
        });
        selectComfyCkpt?.addEventListener('change', (e) => {
            this.aiTextureService.setComfyUiCheckpoint(e.target.value);
        });
        inputApiKey?.addEventListener('input', (e) => {
            this.aiTextureService.setApiKey(e.target.value);
        });
        inputLocalUrl?.addEventListener('input', (e) => {
            this.aiTextureService.setLocalUrl(e.target.value);
        });

        // Bezszwowość i format
        toggleSeamless?.addEventListener('change', (e) => {
            this.aiTextureService.isSeamless = e.target.checked;
        });
        selectAspect?.addEventListener('change', (e) => {
            this.aiTextureService.setAspectRatio(e.target.value);
        });

        // Wskaźnik postępu
        this.aiTextureService.onStatusUpdate = ({ message, percent }) => {
            if (progressFill) progressFill.style.width = `${percent}%`;
            if (progressStatus) progressStatus.textContent = message;
        };

        const renderHistory = () => {
            if (!historyContainer || !historySection) return;
            if (this.aiTextureService.history.length === 0) {
                historySection.style.display = 'none';
                return;
            }
            historySection.style.display = 'flex';
            historyContainer.innerHTML = '';
            this.aiTextureService.history.forEach((item, idx) => {
                const hCard = document.createElement('div');
                hCard.className = `ai-history-card ${idx === 0 ? 'active' : ''}`;
                hCard.title = `${item.prompt} (${new Date(item.timestamp).toLocaleTimeString()})`;
                hCard.innerHTML = `<img src="${item.dataUrl}" alt="Wariant AI ${idx + 1}">`;
                hCard.addEventListener('click', () => {
                    historyContainer.querySelectorAll('.ai-history-card').forEach(c => c.classList.remove('active'));
                    hCard.classList.add('active');
                    this.aiTextureService.currentResult = item;
                    if (previewImg) previewImg.src = item.dataUrl;
                    if (previewBox) previewBox.style.display = 'flex';
                    this.brandingManager.applyAiTexture(item.dataUrl, item, () => {
                        const toggle = document.getElementById('toggle-panorama-enable');
                        if (toggle && !toggle.checked) toggle.checked = true;
                        document.querySelectorAll('.panorama-card').forEach(c => c.classList.remove('active'));
                        this.showToast('Zastosowano grafikę z historii na 3D.');
                    });
                });
                historyContainer.appendChild(hCard);
            });
        };

        // Metoda przywracająca stan generatora AI przy wczytaniu pliku projektu .json
        this.restoreAiGeneratorFromProject = (aiMeta, dataUrl) => {
            if (!aiMeta || !dataUrl) return;
            const item = {
                dataUrl: dataUrl,
                prompt: aiMeta.prompt || 'Projekt Artbar AI',
                styleId: aiMeta.styleId || 'marble_gold',
                isSeamless: aiMeta.isSeamless !== false,
                aspectRatioId: aiMeta.aspectRatioId || 'bar_1x',
                spanModules: aiMeta.spanModules || 1,
                provider: aiMeta.provider || 'comfyui',
                timestamp: aiMeta.timestamp || Date.now()
            };
            this.aiTextureService.currentResult = item;
            this.aiTextureService.addToHistory(item);
            if (previewImg) previewImg.src = dataUrl;
            if (previewBox) previewBox.style.display = 'flex';
            if (promptInput && aiMeta.prompt) promptInput.value = aiMeta.prompt;
            if (aiMeta.styleId) {
                this.aiTextureService.setStyle(aiMeta.styleId);
                stylesContainer?.querySelectorAll('.ai-style-card').forEach(c => {
                    c.classList.toggle('active', c.dataset.styleId === aiMeta.styleId);
                });
            }
            if (aiMeta.aspectRatioId && selectAspect) {
                selectAspect.value = aiMeta.aspectRatioId;
                this.aiTextureService.setAspectRatio(aiMeta.aspectRatioId);
            }
            renderHistory();
        };

        const doGenerate = async () => {
            if (this.aiTextureService.isGenerating) return;

            const userText = promptInput?.value || '';
            if (btnGenerate) btnGenerate.disabled = true;
            if (btnGenerateTxt) btnGenerateTxt.textContent = 'Generowanie tła AI...';
            if (progressBox) progressBox.style.display = 'flex';
            if (progressFill) progressFill.style.width = '10%';

            try {
                const result = await this.aiTextureService.generateTexture(userText);

                // Pokaż podgląd
                if (previewBox) previewBox.style.display = 'flex';
                if (previewImg) previewImg.src = result.dataUrl;

                // Automatycznie zastosuj na bary 3D w scenie
                this.brandingManager.applyAiTexture(result.dataUrl, result, () => {
                    const toggle = document.getElementById('toggle-panorama-enable');
                    if (toggle && !toggle.checked) toggle.checked = true;
                    document.querySelectorAll('.panorama-card').forEach(c => c.classList.remove('active'));
                    
                    // Dopasuj długość fali/modułów do wybranej proporcji (1 moduł, 2 moduły lub 3 moduły)
                    if (result.spanModules) {
                        this.brandingManager.setBackgroundSpan(result.spanModules);
                        const sliderSpan = document.getElementById('slider-panorama-span');
                        const valSpan = document.getElementById('val-panorama-span');
                        if (sliderSpan) sliderSpan.value = result.spanModules;
                        if (valSpan) valSpan.textContent = `${result.spanModules} barów (${(result.spanModules * 1.5).toFixed(1)} m)`;
                    }
                });

                renderHistory();
                this.showToast('Tło AI zostało pomyślnie wygenerowane i nałożone na bary 3D!');
            } catch (err) {
                console.error('Błąd generacji AI:', err);
                this.showToast(`Błąd generacji AI: ${err.message}`);
                alert(`Błąd generacji AI: ${err.message}`);
            } finally {
                if (btnGenerate) btnGenerate.disabled = false;
                if (btnGenerateTxt) btnGenerateTxt.textContent = 'Generuj tło frontu AI';
                setTimeout(() => {
                    if (progressBox) progressBox.style.display = 'none';
                }, 1200);
            }
        };

        btnGenerate?.addEventListener('click', doGenerate);
        btnReroll?.addEventListener('click', doGenerate);

        btnApply?.addEventListener('click', () => {
            const cur = this.aiTextureService.currentResult;
            if (cur && cur.dataUrl) {
                this.brandingManager.applyAiTexture(cur.dataUrl, cur, () => {
                    const toggle = document.getElementById('toggle-panorama-enable');
                    if (toggle && !toggle.checked) toggle.checked = true;
                    document.querySelectorAll('.panorama-card').forEach(c => c.classList.remove('active'));
                    this.showToast('Zastosowano grafikę AI na frontach baru.');
                });
            }
        });

        btnDownload?.addEventListener('click', () => {
            const cur = this.aiTextureService.currentResult;
            if (cur && cur.dataUrl) {
                const timestamp = new Date().toISOString().slice(0, 10);
                this.aiTextureService.downloadImage(cur.dataUrl, `artbar-tlo-ai-${cur.styleId}-${timestamp}.png`);
                this.showToast('Pobieranie grafiki AI w wysokiej rozdzielczości...');
            }
        });
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
