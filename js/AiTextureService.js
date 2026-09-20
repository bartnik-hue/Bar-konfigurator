/**
 * AiTextureService.js
 * Moduł generowania teł i tekstur frontów barowych z wykorzystaniem:
 * 1. ComfyUI (Lokalne API na http://127.0.0.1:8188 z obsługą proxy)
 * 2. Stability AI Cloud API (SDXL / SD 3.5 w chmurze - model BYOK)
 * 3. AUTOMATIC1111 WebUI (Lokalne API na http://127.0.0.1:7860)
 * 4. Szybki tryb demonstracyjny / proceduralny
 */

export const AI_STYLE_PRESETS = [
    {
        id: 'marble_gold',
        name: 'Marmur & Onyks',
        desc: 'Czarny marmur ze złotymi żyłkami i refleksem',
        icon: '🏛',
        basePrompt: 'luxury black marble surface texture, intricate organic gold veins, polished onyx reflections, subtle golden flecks, architectural stone panel, photorealistic, 8k, ultra detailed, elegant interior design, seamless flat texture',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#facb7d'
    },
    {
        id: 'art_deco',
        name: 'Art Deco & Złoto',
        desc: 'Złota geometria na welurowym granacie',
        icon: '✨',
        basePrompt: 'luxurious art deco geometric pattern, brushed brass and gold inlays, deep navy blue velvet background, symmetrical 1920s glamour, high-end bar front decorative panel, architectural texture, seamless pattern, 8k',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#e5b869'
    },
    {
        id: 'botanical',
        name: 'Egzotyczna Botanika',
        desc: 'Ciemna zieleń, liście monstery i storczyki',
        icon: '🌿',
        basePrompt: 'dark moody luxury tropical wallpaper texture, rich emerald green palm leaves, exotic golden orchids, subtle rainforest mist, deep teal shadows, architectural mural pattern, photorealistic, 8k, seamless pattern',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#4ade80'
    },
    {
        id: 'fluid_art',
        name: 'Płynny Akryl & Agat',
        desc: 'Płynny marmur, fale żywicy i złoty pył',
        icon: '🌌',
        basePrompt: 'luxurious fluid acrylic pour art, swirls of gold leaf dust, deep sapphire blue and charcoal obsidian resin, glossy marble swirl, liquid stone texture, high-end hotel counter front, 8k, macro details',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#38bdf8'
    },
    {
        id: 'loft_copper',
        name: 'Loft & Miedź',
        desc: 'Architektoniczny beton z miedzianymi fugami',
        icon: '🧱',
        basePrompt: 'minimalist brutalist architectural raw concrete panel, warm brushed copper inlays and seams, industrial luxury texture, subtle patinated metal lines, modern lounge bar counter facade, photorealistic, 8k',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#fb923c'
    },
    {
        id: 'wedding_glam',
        name: 'Perła & Pastel Glamour',
        desc: 'Szampańskie złoto, perła i delikatne pastele',
        icon: '🌸',
        basePrompt: 'soft pearl white textured luxury backdrop, subtle shimmering champagne gold dust, delicate blush pink floral damask, elegant romantic wedding reception bar decor, subtle lighting, photorealistic, 8k',
        negativePrompt: 'people, human, faces, text, watermark, signature, blurry, low quality, 3d furniture, drinks, perspective',
        accentColor: '#f472b6'
    }
];

export const ARTBAR_ASPECT_RATIOS = [
    { id: 'bar_1x', name: '1 Moduł Baru (1.5m × 0.95m - 1216×768) [Zalecany]', width: 1216, height: 768, spanModules: 1 },
    { id: 'bar_1x_hd', name: '1 Moduł Baru HD (1.5m × 0.95m - 1536×960)', width: 1536, height: 960, spanModules: 1 },
    { id: 'bar_2x', name: 'Podwójny Bar (3.0m × 0.95m - 1536×480)', width: 1536, height: 480, spanModules: 2 },
    { id: 'bar_3x', name: 'Potrójny Bar (4.5m × 0.95m - 1536×320)', width: 1536, height: 320, spanModules: 3 },
    { id: 'square', name: 'Kwadrat Bezszwowy (1:1 - 1024×1024)', width: 1024, height: 1024, spanModules: 1 }
];

export class AiTextureService {
    constructor() {
        this.provider = localStorage.getItem('artbar_ai_provider') || 'comfyui'; // 'comfyui' | 'cloud' | 'automatic1111' | 'demo'
        this.stabilityApiKey = localStorage.getItem('artbar_stability_key') || '';
        this.comfyUiUrl = localStorage.getItem('artbar_comfyui_url') || 'http://127.0.0.1:8188';
        this.comfyUiCheckpoint = localStorage.getItem('artbar_comfyui_ckpt') || '';
        this.localWebUiUrl = localStorage.getItem('artbar_local_sd_url') || 'http://127.0.0.1:7860';
        
        this.activeStyleId = 'marble_gold';
        this.isSeamless = true;
        this.aspectRatioId = 'bar_1x';
        
        this.history = [];
        this.currentResult = null;
        this.isGenerating = false;
        this.cachedCheckpoints = [];
        
        this.onStatusUpdate = null;
    }

    setProvider(provider) {
        if (['comfyui', 'cloud', 'automatic1111', 'demo'].includes(provider)) {
            this.provider = provider;
            localStorage.setItem('artbar_ai_provider', provider);
        }
    }

    setApiKey(key) {
        this.stabilityApiKey = (key || '').trim();
        localStorage.setItem('artbar_stability_key', this.stabilityApiKey);
    }

    setComfyUiUrl(url) {
        this.comfyUiUrl = (url || '').trim() || 'http://127.0.0.1:8188';
        localStorage.setItem('artbar_comfyui_url', this.comfyUiUrl);
    }

    setComfyUiCheckpoint(ckpt) {
        this.comfyUiCheckpoint = (ckpt || '').trim();
        localStorage.setItem('artbar_comfyui_ckpt', this.comfyUiCheckpoint);
    }

    setLocalUrl(url) {
        this.localWebUiUrl = (url || '').trim() || 'http://127.0.0.1:7860';
        localStorage.setItem('artbar_local_sd_url', this.localWebUiUrl);
    }

    setStyle(styleId) {
        const found = AI_STYLE_PRESETS.find(s => s.id === styleId);
        if (found) {
            this.activeStyleId = styleId;
        }
    }

    setAspectRatio(id) {
        const found = ARTBAR_ASPECT_RATIOS.find(r => r.id === id);
        if (found) {
            this.aspectRatioId = id;
        }
    }

    getDimensions() {
        const found = ARTBAR_ASPECT_RATIOS.find(r => r.id === this.aspectRatioId) || ARTBAR_ASPECT_RATIOS[0];
        return { width: found.width, height: found.height, spanModules: found.spanModules };
    }

    /**
     * Wzbogaca prompt użytkownika o styl architektoniczny i słowa kluczowe gwarantujące jakość
     */
    buildPrompts(userPrompt = '') {
        const style = AI_STYLE_PRESETS.find(s => s.id === this.activeStyleId) || AI_STYLE_PRESETS[0];
        const trimmedUser = (userPrompt || '').trim();
        
        let positive = '';
        if (trimmedUser) {
            positive = `${trimmedUser}, luxury architectural bar front panel, ${style.basePrompt}`;
        } else {
            positive = style.basePrompt;
        }

        if (this.isSeamless) {
            positive += ', seamless tileable repeating pattern, continuous seamless texture, flat 2d elevation';
        } else {
            positive += ', flat 2d architectural elevation, front facing';
        }

        const negative = `${style.negativePrompt}, low quality, blurry, watermark, cropped, noisy, 3d render of room, angled view, perspective distortion`;

        return { positive, negative };
    }

    /**
     * Sprawdza dostępność ComfyUI i pobiera listę zainstalowanych modeli checkpoint
     */
    async fetchComfyUiCheckpoints() {
        // Próba przez lokalne proxy serwera lub bezpośrednio
        const endpoints = [
            '/api/comfyui/object_info/CheckpointLoaderSimple',
            `${this.comfyUiUrl.replace(/\/+$/, '')}/object_info/CheckpointLoaderSimple`
        ];

        for (const ep of endpoints) {
            try {
                const res = await fetch(ep, { method: 'GET', headers: { 'Accept': 'application/json' } });
                if (res.ok) {
                    const data = await res.json();
                    const ckpts = data?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
                    if (Array.isArray(ckpts) && ckpts.length > 0) {
                        this.cachedCheckpoints = ckpts;
                        if (!this.comfyUiCheckpoint || !ckpts.includes(this.comfyUiCheckpoint)) {
                            this.setComfyUiCheckpoint(ckpts[0]);
                        }
                        return ckpts;
                    }
                }
            } catch (e) {
                // ignoruj błąd endpointa i sprawdź następny
            }
        }
        return this.cachedCheckpoints;
    }

    /**
     * Główna metoda wywołująca generację w wybranym silniku
     */
    async generateTexture(userPrompt = '') {
        if (this.isGenerating) {
            throw new Error('Generacja jest już w toku. Poczekaj na zakończenie.');
        }

        this.isGenerating = true;
        this.notifyStatus('Inicjalizacja generowania grafiki AI...', 10);

        const { positive, negative } = this.buildPrompts(userPrompt);
        const dims = this.getDimensions();

        try {
            let dataUrl = null;

            if (this.provider === 'comfyui') {
                dataUrl = await this.generateComfyUi(positive, negative, dims);
            } else if (this.provider === 'cloud') {
                dataUrl = await this.generateCloudStability(positive, negative, dims);
            } else if (this.provider === 'automatic1111') {
                dataUrl = await this.generateLocalWebUi(positive, negative, dims);
            } else {
                // Tryb Demonstracyjny / Proceduralny (szybki test bez kluczy i bez GPU)
                dataUrl = await this.generateProceduralDemo(userPrompt, positive, dims);
            }

            const result = {
                dataUrl,
                prompt: userPrompt || (AI_STYLE_PRESETS.find(s => s.id === this.activeStyleId)?.name || 'Custom'),
                styleId: this.activeStyleId,
                isSeamless: this.isSeamless,
                aspectRatioId: this.aspectRatioId,
                spanModules: dims.spanModules,
                provider: this.provider,
                timestamp: Date.now()
            };

            this.currentResult = result;
            this.addToHistory(result);

            this.notifyStatus('Gotowe! Grafika wygenerowana.', 100);
            return result;
        } catch (err) {
            this.notifyStatus(`Błąd: ${err.message}`, 0);
            throw err;
        } finally {
            this.isGenerating = false;
        }
    }

    /**
     * Generacja poprzez lokalne API ComfyUI (http://127.0.0.1:8188)
     */
    async generateComfyUi(positivePrompt, negativePrompt, dims) {
        this.notifyStatus(`Sprawdzanie połączenia z ComfyUI...`, 20);

        // Pobierz aktualną listę modeli jeśli jeszcze nie pobrano
        let ckpts = this.cachedCheckpoints;
        if (!ckpts || ckpts.length === 0) {
            ckpts = await this.fetchComfyUiCheckpoints();
        }

        const ckptName = this.comfyUiCheckpoint || (ckpts.length > 0 ? ckpts[0] : 'v1-5-pruned-emaonly.safetensors');
        const seed = Math.floor(Math.random() * 1000000000000);
        const clientId = 'artbar_' + Date.now();

        // Standardowy graf Text-To-Image dla ComfyUI
        const promptGraph = {
            "3": {
                "inputs": {
                    "seed": seed,
                    "steps": 25,
                    "cfg": 7.0,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "karras",
                    "denoise": 1.0,
                    "model": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["5", 0]
                },
                "class_type": "KSampler"
            },
            "4": {
                "inputs": {
                    "ckpt_name": ckptName
                },
                "class_type": "CheckpointLoaderSimple"
            },
            "5": {
                "inputs": {
                    "width": dims.width,
                    "height": dims.height,
                    "batch_size": 1
                },
                "class_type": "EmptyLatentImage"
            },
            "6": {
                "inputs": {
                    "text": positivePrompt,
                    "clip": ["4", 1]
                },
                "class_type": "CLIPTextEncode"
            },
            "7": {
                "inputs": {
                    "text": negativePrompt,
                    "clip": ["4", 1]
                },
                "class_type": "CLIPTextEncode"
            },
            "8": {
                "inputs": {
                    "samples": ["3", 0],
                    "vae": ["4", 2]
                },
                "class_type": "VAEDecode"
            },
            "9": {
                "inputs": {
                    "filename_prefix": "Artbar_Front",
                    "images": ["8", 0]
                },
                "class_type": "SaveImage"
            }
        };

        const postBody = JSON.stringify({ prompt: promptGraph, client_id: clientId });

        // Endpointy do wysłania promptu (preferuj proxy serwera localhost:3050/api/comfyui, potem direct)
        const promptUrls = [
            '/api/comfyui/prompt',
            `${this.comfyUiUrl.replace(/\/+$/, '')}/prompt`
        ];

        let promptId = null;
        let activePrefix = '';

        for (const url of promptUrls) {
            try {
                this.notifyStatus('Wysyłanie zadania do ComfyUI...', 35);
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: postBody
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.prompt_id) {
                        promptId = data.prompt_id;
                        activePrefix = url.startsWith('/api/comfyui') ? '/api/comfyui' : this.comfyUiUrl.replace(/\/+$/, '');
                        break;
                    }
                }
            } catch (e) {}
        }

        if (!promptId) {
            throw new Error(`Nie udało się połączyć z ComfyUI (${this.comfyUiUrl}). Upewnij się, że ComfyUI jest uruchomione na Twoim komputerze.`);
        }

        // Odpytywanie o wynik generowania (polling historii)
        this.notifyStatus('Generowanie obrazu w ComfyUI na GPU...', 50);
        let outputImageInfo = null;
        const maxAttempts = 120; // 60 sekund maks
        let attempt = 0;

        while (attempt < maxAttempts) {
            await new Promise(r => setTimeout(r, 600));
            attempt++;
            
            const progressPct = Math.min(90, 50 + Math.round((attempt / 40) * 40));
            this.notifyStatus(`Generowanie na karcie GPU w toku (${attempt * 0.6}s)...`, progressPct);

            try {
                const historyUrl = `${activePrefix}/history/${promptId}`;
                const hRes = await fetch(historyUrl);
                if (hRes.ok) {
                    const hData = await hRes.json();
                    if (hData && hData[promptId] && hData[promptId].outputs) {
                        const outputs = hData[promptId].outputs;
                        // Szukamy węzła SaveImage (id "9")
                        if (outputs["9"] && outputs["9"].images && outputs["9"].images.length > 0) {
                            outputImageInfo = outputs["9"].images[0];
                            break;
                        }
                    }
                }
            } catch (pollErr) {}
        }

        if (!outputImageInfo) {
            throw new Error('ComfyUI: przekroczono limit czasu oczekiwania na zakończenie generacji.');
        }

        // Pobranie wygenerowanego pliku
        this.notifyStatus('Pobieranie gotowego obrazu z ComfyUI...', 92);
        const viewUrl = `${activePrefix}/view?filename=${encodeURIComponent(outputImageInfo.filename)}&subfolder=${encodeURIComponent(outputImageInfo.subfolder || '')}&type=${encodeURIComponent(outputImageInfo.type || 'output')}`;
        
        const imgRes = await fetch(viewUrl);
        if (!imgRes.ok) {
            throw new Error(`ComfyUI: błąd pobierania obrazu (${imgRes.status}).`);
        }

        const blob = await imgRes.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Błąd odczytu pliku z ComfyUI.'));
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Generacja przez Stability AI Cloud REST API (SDXL)
     */
    async generateCloudStability(positivePrompt, negativePrompt, dims) {
        if (!this.stabilityApiKey) {
            throw new Error('Brak klucza Stability AI API. Wprowadź klucz w ustawieniach (ikona ⚙) lub wybierz ComfyUI / Demo.');
        }

        this.notifyStatus('Łączenie z chmurą Stability AI (SDXL)...', 30);

        const url = 'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image';
        
        const body = {
            text_prompts: [
                { text: positivePrompt, weight: 1.0 },
                { text: negativePrompt, weight: -1.0 }
            ],
            cfg_scale: 7.5,
            height: dims.height,
            width: dims.width,
            samples: 1,
            steps: 30
        };

        this.notifyStatus('Generowanie obrazu w chmurze...', 60);

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'Authorization': `Bearer ${this.stabilityApiKey}`
            },
            body: JSON.stringify(body)
        });

        if (!response.ok) {
            let errMsg = `Błąd HTTP ${response.status}`;
            try {
                const errJson = await response.json();
                if (errJson.message) errMsg = errJson.message;
            } catch (e) {}
            throw new Error(`Stability AI: ${errMsg}`);
        }

        const data = await response.json();
        if (!data.artifacts || data.artifacts.length === 0) {
            throw new Error('Stability AI nie zwróciło żadnego obrazu.');
        }

        const base64 = data.artifacts[0].base64;
        return `data:image/png;base64,${base64}`;
    }

    /**
     * Generacja przez Lokalne AUTOMATIC1111 WebUI
     */
    async generateLocalWebUi(positivePrompt, negativePrompt, dims) {
        this.notifyStatus(`Łączenie z lokalnym WebUI (${this.localWebUiUrl})...`, 25);

        const endpoints = [
            '/api/sd/sdapi/v1/txt2img',
            `${this.localWebUiUrl.replace(/\/+$/, '')}/sdapi/v1/txt2img`
        ];

        const payload = {
            prompt: positivePrompt,
            negative_prompt: negativePrompt,
            tiling: this.isSeamless,
            width: dims.width,
            height: dims.height,
            steps: 25,
            cfg_scale: 7.0,
            sampler_name: 'DPM++ 2M Karras'
        };

        this.notifyStatus('Generowanie obrazu na karcie graficznej GPU...', 55);

        for (const ep of endpoints) {
            try {
                const res = await fetch(ep, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (res.ok) {
                    const data = await res.json();
                    if (data.images && data.images.length > 0) {
                        return `data:image/png;base64,${data.images[0]}`;
                    }
                }
            } catch (e) {}
        }

        throw new Error(`Nie udało się połączyć z AUTOMATIC1111 na ${this.localWebUiUrl}. Upewnij się, że uruchomiono z flagą --api.`);
    }

    /**
     * Szybki i fotorealistyczny generator proceduralny w trybie demonstracyjnym.
     */
    async generateProceduralDemo(userPrompt = '', positivePrompt = '', dims) {
        this.notifyStatus('Generowanie wariantu tła demonstracyjnego...', 40);
        await new Promise(r => setTimeout(r, 600));

        const width = dims.width;
        const height = dims.height;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');

        const styleId = this.activeStyleId;
        const seed = Math.random();

        // 1. Tło bazowe
        let grad = ctx.createLinearGradient(0, 0, width, height);
        if (styleId === 'marble_gold') {
            grad.addColorStop(0, '#0a0a0c');
            grad.addColorStop(0.5, '#16161a');
            grad.addColorStop(1, '#0e0e12');
        } else if (styleId === 'art_deco') {
            grad.addColorStop(0, '#071527');
            grad.addColorStop(0.5, '#0b213f');
            grad.addColorStop(1, '#051120');
        } else if (styleId === 'botanical') {
            grad.addColorStop(0, '#03140a');
            grad.addColorStop(0.5, '#072414');
            grad.addColorStop(1, '#020e06');
        } else if (styleId === 'fluid_art') {
            grad.addColorStop(0, '#0f172a');
            grad.addColorStop(0.4, '#1e1b4b');
            grad.addColorStop(0.8, '#311042');
            grad.addColorStop(1, '#090d16');
        } else if (styleId === 'loft_copper') {
            grad.addColorStop(0, '#262629');
            grad.addColorStop(0.5, '#3a3a3e');
            grad.addColorStop(1, '#202022');
        } else {
            // wedding_glam
            grad.addColorStop(0, '#faf6f0');
            grad.addColorStop(0.5, '#f5e8e4');
            grad.addColorStop(1, '#ece0d8');
        }
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, width, height);

        // 2. Fale i żyłki
        const waveCount = styleId === 'art_deco' ? 14 : 9;
        ctx.save();
        for (let i = 0; i < waveCount; i++) {
            ctx.beginPath();
            const startY = (height / waveCount) * i + (Math.sin(seed * 10 + i) * 30);
            ctx.moveTo(0, startY);

            for (let x = 0; x <= width; x += 40) {
                const nx = x / width;
                const freq = styleId === 'art_deco' ? 16 : 4;
                const waveY = startY + Math.sin(nx * Math.PI * freq + i * 1.5 + seed * 6) * (styleId === 'art_deco' ? 25 : 60);
                ctx.lineTo(x, waveY);
            }

            if (styleId === 'art_deco') {
                ctx.strokeStyle = `rgba(229, 184, 105, ${0.18 + (i % 3) * 0.12})`;
                ctx.lineWidth = 2.0;
                ctx.stroke();
            } else if (styleId === 'loft_copper') {
                ctx.strokeStyle = `rgba(217, 119, 6, ${0.15 + (i % 2) * 0.20})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            } else if (styleId === 'wedding_glam') {
                ctx.strokeStyle = `rgba(212, 163, 115, ${0.20 + (i % 3) * 0.15})`;
                ctx.lineWidth = 2.5;
                ctx.stroke();
            } else {
                ctx.strokeStyle = `rgba(250, 203, 125, ${0.25 + (i % 4) * 0.18})`;
                ctx.lineWidth = 1.2 + (i % 3) * 1.6;
                ctx.stroke();
            }
        }
        ctx.restore();

        // 3. Detale: złoty pył
        ctx.save();
        const dotCount = 180;
        for (let d = 0; d < dotCount; d++) {
            const rx = (Math.sin(d * 19.3 + seed * 5) * 0.5 + 0.5) * width;
            const ry = (Math.cos(d * 31.7 + seed * 8) * 0.5 + 0.5) * height;
            const rSize = 0.8 + (Math.sin(d) * 0.5 + 0.5) * 2.2;
            ctx.beginPath();
            ctx.arc(rx, ry, rSize, 0, Math.PI * 2);
            ctx.fillStyle = styleId === 'wedding_glam' ? 'rgba(212, 163, 115, 0.45)' : 'rgba(250, 203, 125, 0.55)';
            ctx.fill();
        }
        ctx.restore();

        // 4. Bezszwowy blend krawędzi
        if (this.isSeamless) {
            const blendW = 60;
            const leftData = ctx.getImageData(0, 0, blendW, height);
            const rightData = ctx.getImageData(width - blendW, 0, blendW, height);
            
            for (let y = 0; y < height; y++) {
                for (let x = 0; x < blendW; x++) {
                    const factor = x / blendW;
                    const idx = (y * blendW + x) * 4;
                    leftData.data[idx] = Math.round(leftData.data[idx] * factor + rightData.data[idx] * (1 - factor));
                    leftData.data[idx + 1] = Math.round(leftData.data[idx + 1] * factor + rightData.data[idx + 1] * (1 - factor));
                    leftData.data[idx + 2] = Math.round(leftData.data[idx + 2] * factor + rightData.data[idx + 2] * (1 - factor));
                }
            }
            ctx.putImageData(leftData, 0, 0);
        }

        this.notifyStatus('Finalizowanie tekstury...', 90);
        return canvas.toDataURL('image/jpeg', 0.92);
    }

    addToHistory(item) {
        this.history.unshift(item);
        if (this.history.length > 8) {
            this.history.pop();
        }
    }

    downloadImage(dataUrl, filename = 'artbar-front-graphic.png') {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    notifyStatus(message, percent = 0) {
        if (typeof this.onStatusUpdate === 'function') {
            this.onStatusUpdate({ message, percent });
        }
    }
}
