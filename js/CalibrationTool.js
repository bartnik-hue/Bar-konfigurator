/**
 * Narzędzie administracyjne kalibracji offsetów, wymiarów i punktów styku modułów.
 * Obsługuje niezależną kalibrację Narożnika Prawego i Narożnika Lewego,
 * milimetrową precyzję (step 0.001), bezpośrednie pola liczbowe oraz przyciski mikro-kroków.
 */
export class CalibrationTool {
    constructor(registry, barBuilder, containerElement) {
        this.registry = registry;
        this.barBuilder = barBuilder;
        this.container = containerElement;
        this.currentModelKey = 'barCornerRight';

        this.initUI();
    }

    initUI() {
        this.container.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 14px;">
                <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;">
                    <button class="hud-btn active" data-model="barCornerRight" style="font-size: 0.70rem; padding: 5px 3px;">Róg Prawy</button>
                    <button class="hud-btn" data-model="barCornerLeft" style="font-size: 0.70rem; padding: 5px 3px;">Róg Lewy</button>
                    <button class="hud-btn" data-model="barStraight" style="font-size: 0.70rem; padding: 5px 3px;">Bar Prosty</button>
                    <button class="hud-btn" data-model="barCornerRightOut" style="font-size: 0.70rem; padding: 5px 3px; color: #FACB7D;" title="Offset baru dodawanego do rogu prawego">Róg P. ➔ Bar</button>
                    <button class="hud-btn" data-model="barCornerLeftOut" style="font-size: 0.70rem; padding: 5px 3px; color: #FACB7D;" title="Offset baru dodawanego do rogu lewego">Róg L. ➔ Bar</button>
                    <button class="hud-btn" data-model="regal" style="font-size: 0.70rem; padding: 5px 3px;">Regał</button>
                    <button class="hud-btn" data-model="fridge" style="font-size: 0.70rem; padding: 5px 3px;">Lodówka</button>
                    <button class="hud-btn" data-model="logoBarStraight" style="font-size: 0.70rem; padding: 5px 3px; color: #60a5fa;" title="Pozycja i rozmiar logo na barze prostym">Logo Bar</button>
                </div>

                <div class="calib-group" style="background: rgba(20, 20, 24, 0.95); border: 1px solid rgba(250, 203, 125, 0.2); border-radius: 8px; padding: 12px; display: flex; flex-direction: column; gap: 12px;">
                    <div class="calib-title" id="calib-model-title" style="font-weight: 700; color: #FACB7D; font-size: 0.88rem; border-bottom: 1px solid rgba(255,255,255,0.1); padding-bottom: 6px;">
                        Kalibracja: Narożnik Prawy
                    </div>
                    
                    <!-- SZEROKOŚĆ / WIDTH -->
                    <div class="calib-param" data-param="width">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Szerokość (W):</label>
                            <input type="number" id="cal-num-width" min="0.1" max="4.0" step="0.001" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-width" min="0.2" max="3.0" step="0.001" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="width" data-delta="-0.010" title="-10 mm">-10</button>
                                <button class="btn-micro" data-param="width" data-delta="-0.001" title="-1 mm">-1</button>
                                <button class="btn-micro" data-param="width" data-delta="0.001" title="+1 mm">+1</button>
                                <button class="btn-micro" data-param="width" data-delta="0.010" title="+10 mm">+10</button>
                            </div>
                        </div>
                    </div>

                    <!-- WYSOKOŚĆ / HEIGHT (dla płaszczyzn logo) -->
                    <div class="calib-param" data-param="height" id="calib-param-height" style="display: none;">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Wysokość (H):</label>
                            <input type="number" id="cal-num-height" min="0.05" max="3.0" step="0.001" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-height" min="0.05" max="2.0" step="0.001" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="height" data-delta="-0.010" title="-10 mm">-10</button>
                                <button class="btn-micro" data-param="height" data-delta="-0.001" title="-1 mm">-1</button>
                                <button class="btn-micro" data-param="height" data-delta="0.001" title="+1 mm">+1</button>
                                <button class="btn-micro" data-param="height" data-delta="0.010" title="+10 mm">+10</button>
                            </div>
                        </div>
                    </div>

                    <!-- OFFSET X -->
                    <div class="calib-param" data-param="ox">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Offset X (lewo / prawo):</label>
                            <input type="number" id="cal-num-ox" min="-3.0" max="3.0" step="0.001" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-ox" min="-2.0" max="2.0" step="0.001" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="ox" data-delta="-0.010" title="-10 mm">-10</button>
                                <button class="btn-micro" data-param="ox" data-delta="-0.001" title="-1 mm">-1</button>
                                <button class="btn-micro" data-param="ox" data-delta="0.001" title="+1 mm">+1</button>
                                <button class="btn-micro" data-param="ox" data-delta="0.010" title="+10 mm">+10</button>
                            </div>
                        </div>
                    </div>

                    <!-- OFFSET Y -->
                    <div class="calib-param" data-param="oy">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Offset Y (wysokość):</label>
                            <input type="number" id="cal-num-oy" min="-1.0" max="1.0" step="0.001" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-oy" min="-1.0" max="1.0" step="0.001" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="oy" data-delta="-0.010" title="-10 mm">-10</button>
                                <button class="btn-micro" data-param="oy" data-delta="-0.001" title="-1 mm">-1</button>
                                <button class="btn-micro" data-param="oy" data-delta="0.001" title="+1 mm">+1</button>
                                <button class="btn-micro" data-param="oy" data-delta="0.010" title="+10 mm">+10</button>
                            </div>
                        </div>
                    </div>

                    <!-- OFFSET Z -->
                    <div class="calib-param" data-param="oz">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Offset Z (przód / tył):</label>
                            <input type="number" id="cal-num-oz" min="-3.0" max="3.0" step="0.001" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-oz" min="-2.0" max="2.0" step="0.001" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="oz" data-delta="-0.010" title="-10 mm">-10</button>
                                <button class="btn-micro" data-param="oz" data-delta="-0.001" title="-1 mm">-1</button>
                                <button class="btn-micro" data-param="oz" data-delta="0.001" title="+1 mm">+1</button>
                                <button class="btn-micro" data-param="oz" data-delta="0.010" title="+10 mm">+10</button>
                            </div>
                        </div>
                    </div>

                    <!-- ROTATION Y -->
                    <div class="calib-param" data-param="rot">
                        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                            <label style="font-size: 0.75rem; color: #ccc;">Obrót wokół środka Y (°):</label>
                            <input type="number" id="cal-num-rot" min="-180" max="180" step="0.1" style="width: 75px; text-align: right; background: #111; color: #FACB7D; border: 1px solid #444; border-radius: 4px; padding: 2px 4px; font-size: 0.75rem; font-family: monospace;">
                        </div>
                        <div style="display: flex; align-items: center; gap: 6px;">
                            <input type="range" id="cal-rot" min="-180" max="180" step="0.5" style="flex: 1;">
                            <div class="micro-buttons" style="display: flex; gap: 3px;">
                                <button class="btn-micro" data-param="rot" data-delta="-5" title="-5°">-5°</button>
                                <button class="btn-micro" data-param="rot" data-delta="-1" title="-1°">-1°</button>
                                <button class="btn-micro" data-param="rot" data-delta="1" title="+1°">+1°</button>
                                <button class="btn-micro" data-param="rot" data-delta="5" title="+5°">+5°</button>
                            </div>
                        </div>
                    </div>
                </div>

                <div style="display: flex; gap: 6px;">
                    <button class="btn-tool active" id="btn-save-calib" style="flex: 1; justify-content: center; font-size: 0.78rem;">
                        💾 Zapisz
                    </button>
                    <button class="btn-tool" id="btn-copy-calib" style="flex: 1; justify-content: center; font-size: 0.78rem;" title="Skopiuj konfigurację JSON do schowka">
                        📋 Kopiuj JSON
                    </button>
                    <button class="btn-tool" id="btn-reset-calib" style="flex: 1; justify-content: center; font-size: 0.78rem;">
                        ↺ Domyślne
                    </button>
                </div>

                <div style="font-size: 0.68rem; color: #aaa; line-height: 1.4; background: rgba(0,0,0,0.4); padding: 8px; border-radius: 6px; border-left: 3px solid #FACB7D;">
                    💡 <strong>Precyzyjna kalibracja 1mm:</strong> Użyj przycisków [±1mm] i [±10mm] lub wpisz wartość z klawiatury. Obrót obraca bryłę wokół jej idealnego geometrycznego środka.
                </div>
            </div>
        `;

        this.bindEvents();
        this.updateSlidersFromModel(this.currentModelKey);
    }

    bindEvents() {
        const tabs = this.container.querySelectorAll('[data-model]');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                this.currentModelKey = tab.dataset.model;
                this.updateSlidersFromModel(this.currentModelKey);
            });
        });

        const params = ['width', 'height', 'ox', 'oy', 'oz', 'rot'];
        params.forEach(param => {
            const range = this.container.querySelector(`#cal-${param}`);
            const num = this.container.querySelector(`#cal-num-${param}`);
            if (!range || !num) return;

            range.addEventListener('input', () => {
                num.value = range.value;
                this.handleValueChange();
            });

            num.addEventListener('input', () => {
                range.value = num.value;
                this.handleValueChange();
            });
        });

        // Przyciski mikro-kroków
        const microBtns = this.container.querySelectorAll('.btn-micro');
        microBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const param = btn.dataset.param;
                const delta = parseFloat(btn.dataset.delta);
                const num = this.container.querySelector(`#cal-num-${param}`);
                const range = this.container.querySelector(`#cal-${param}`);
                if (!num || !range) return;

                let currentVal = parseFloat(num.value) || 0;
                let newVal = currentVal + delta;
                if (param === 'rot') {
                    newVal = Math.round(newVal * 10) / 10;
                } else {
                    newVal = Math.round(newVal * 1000) / 1000;
                }

                num.value = newVal;
                range.value = newVal;
                this.handleValueChange();
            });
        });

        this.container.querySelector('#btn-save-calib').addEventListener('click', () => {
            this.registry.saveCalibration();
            if (window.showToast) window.showToast('Ustawienia kalibracji zapisane pomyślnie!');
        });

        this.container.querySelector('#btn-copy-calib').addEventListener('click', () => {
            const jsonStr = JSON.stringify(this.registry.calibration, null, 2);
            navigator.clipboard.writeText(jsonStr).then(() => {
                if (window.showToast) window.showToast('Skopiowano JSON kalibracji do schowka!');
            }).catch(() => {
                prompt('Skopiuj JSON kalibracji:', jsonStr);
            });
        });

        this.container.querySelector('#btn-reset-calib').addEventListener('click', () => {
            this.registry.resetCalibration();
            this.updateSlidersFromModel(this.currentModelKey);
            this.applyLiveChanges();
            if (window.showToast) window.showToast('Przywrócono domyślne ustawienia kalibracji.');
        });
    }

    updateSlidersFromModel(key) {
        const cal = this.registry.calibration[key] || {};
        this.container.querySelector('#calib-model-title').textContent = `Kalibracja: ${this.getModelLabel(key)}`;
        
        const isLogo = key.startsWith('logo');
        const heightParam = this.container.querySelector('#calib-param-height');
        if (heightParam) {
            heightParam.style.display = isLogo ? 'block' : 'none';
        }

        this.setVal('width', cal.width ?? 1.5);
        this.setVal('height', cal.height ?? 0.45);
        this.setVal('ox', cal.offsetX ?? 0);
        this.setVal('oy', cal.offsetY ?? 0);
        this.setVal('oz', cal.offsetZ ?? 0);
        this.setVal('rot', cal.rotY ?? 0);
    }

    setVal(param, val) {
        const range = this.container.querySelector(`#cal-${param}`);
        const num = this.container.querySelector(`#cal-num-${param}`);
        const formatted = (param === 'rot') ? Number(val).toFixed(1) : Number(val).toFixed(3);
        if (range) range.value = formatted;
        if (num) num.value = formatted;
    }

    handleValueChange() {
        const key = this.currentModelKey;
        const width = parseFloat(this.container.querySelector('#cal-num-width').value) || 0;
        const height = parseFloat(this.container.querySelector('#cal-num-height')?.value) || 0.45;
        const ox = parseFloat(this.container.querySelector('#cal-num-ox').value) || 0;
        const oy = parseFloat(this.container.querySelector('#cal-num-oy').value) || 0;
        const oz = parseFloat(this.container.querySelector('#cal-num-oz').value) || 0;
        const rot = parseFloat(this.container.querySelector('#cal-num-rot').value) || 0;

        this.registry.calibration[key] = {
            width: Math.round(width * 1000) / 1000,
            height: Math.round(height * 1000) / 1000,
            offsetX: Math.round(ox * 1000) / 1000,
            offsetY: Math.round(oy * 1000) / 1000,
            offsetZ: Math.round(oz * 1000) / 1000,
            rotY: Math.round(rot * 10) / 10
        };

        this.applyLiveChanges();
    }

    applyLiveChanges() {
        const key = this.currentModelKey;

        // Obsługa kalibracji pozycji i rozmiaru logo na barach
        if (key.startsWith('logo')) {
            const cal = this.registry.calibration[key] || {};
            const targetModKey = (key === 'logoBarStraight') ? 'BAR_STRAIGHT' :
                                 (key === 'logoCornerRight') ? 'BAR_CORNER_RIGHT' : 'BAR_CORNER_LEFT';

            this.barBuilder.modules.forEach(m => {
                if (m.modelKey === targetModKey || (targetModKey === 'BAR_CORNER_RIGHT' && m.modelKey === 'BAR_CORNER')) {
                    const plane = m.mesh.getObjectByName('LogoPlane');
                    if (plane) {
                        plane.position.set(cal.offsetX || 0, cal.offsetY !== undefined ? cal.offsetY : 0.55, cal.offsetZ !== undefined ? cal.offsetZ : 0.225);
                        plane.rotation.y = (cal.rotY || 0) * (Math.PI / 180);
                        if (plane.geometry) {
                            plane.geometry.dispose();
                            plane.geometry = new THREE.PlaneGeometry(cal.width || 1.10, cal.height || 0.45);
                        }
                    }
                }
            });
            return;
        }

        // Specjalna obsługa offsetu dla modułów dodanych do wyjścia rogu
        if (key === 'barCornerRightOut' || key === 'barCornerLeftOut') {
            const isRight = (key === 'barCornerRightOut');
            const parentCornerKey = isRight ? 'BAR_CORNER_RIGHT' : 'BAR_CORNER_LEFT';
            const cal = this.registry.calibration[key] || {};

            this.barBuilder.modules.forEach(m => {
                if (m.attachedTo?.parentModelKey === parentCornerKey && m.attachedTo?.socketId === 'out') {
                    const parent = this.barBuilder.modules.find(p => p.id === m.attachedTo.parentModuleId);
                    if (parent) {
                        const parentCal = this.registry.getCalibrationFor(parent.modelKey) || { width: 0.95 };
                        const newCal = this.registry.getCalibrationFor(m.modelKey) || { width: 1.5 };
                        const offset = (parentCal.width / 2) + (newCal.width / 2);
                        const parentRot = parent.mesh.rotation.y;
                        const targetRot = isRight ? (parentRot + Math.PI / 2) : (parentRot - Math.PI / 2);
                        const nominalShift = new THREE.Vector3(0, 0, -offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), parentRot);
                        const fineShift = new THREE.Vector3(cal.offsetX || 0, cal.offsetY || 0, cal.offsetZ || 0)
                            .applyAxisAngle(new THREE.Vector3(0, 1, 0), targetRot);

                        m.mesh.position.copy(parent.mesh.position).add(nominalShift).add(fineShift);
                    }
                }
            });
            return;
        }

        const targetModelKeys = this.mapToModelKeys(key);
        
        // Zaktualizuj istniejące moduły na scenie
        this.barBuilder.modules.forEach(m => {
            if (targetModelKeys.includes(m.modelKey)) {
                // children[0] to PivotCalibrationNode
                const pivotNode = m.mesh.children[0];
                if (pivotNode) {
                    this.registry.applyCalibrationToInstance(pivotNode, m.modelKey);
                }
            }
        });

        // Jeśli zaznaczony moduł ma ten typ, odśwież kropki połączeń
        if (this.barBuilder.selectedModule && targetModelKeys.includes(this.barBuilder.selectedModule.modelKey)) {
            this.barBuilder.generateSocketHandles(this.barBuilder.selectedModule);
        }
    }

    mapToModelKeys(key) {
        switch (key) {
            case 'barStraight':         return ['BAR_STRAIGHT'];
            case 'barCornerRight':      return ['BAR_CORNER_RIGHT', 'BAR_CORNER'];
            case 'barCornerLeft':       return ['BAR_CORNER_LEFT'];
            case 'barCornerRightOut':   return [];
            case 'barCornerLeftOut':    return [];
            case 'regal':               return ['BACK_SHELF'];
            case 'fridge':              return ['BACK_FRIDGE'];
            default: return [];
        }
    }

    getModelLabel(key) {
        switch (key) {
            case 'barStraight':         return 'Bar Prosty (1.5m)';
            case 'barCornerRight':      return 'Narożnik Prawy 90°';
            case 'barCornerLeft':       return 'Narożnik Lewy 90°';
            case 'barCornerRightOut':   return 'Bar dodawany do Rogu Prawego';
            case 'barCornerLeftOut':    return 'Bar dodawany do Rogu Lewego';
            case 'regal':               return 'Regał Zaplecza (1.5m)';
            case 'fridge':              return 'Lodówka Eventowa (1.0m)';
            case 'logoBarStraight':     return 'Logo: Bar Prosty';
            case 'logoCornerRight':     return 'Logo: Narożnik Prawy';
            case 'logoCornerLeft':      return 'Logo: Narożnik Lewy';
            default: return key;
        }
    }
}
