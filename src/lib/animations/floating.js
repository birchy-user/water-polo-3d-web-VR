// Dokumentācija: https://aframe.io/docs/1.5.0/core/component.html
AFRAME.registerComponent('float-in-water', {
    /**
     * Apraksta komponentes laukus, to tipus, sākotnējās vērtības
     */
    schema: {
        waveSpeed: { type: 'number', default: 1 },
        originalY: { type: 'number', default: 0 },
        minAmplitude: { type: 'number', default: -1 },
        maxAmplitude: { type: 'number', default: 1 }
    },
  
    /**
     * Metode, kas tiek izpildīta vienu reizi brīdī, kad komponente tiek inicializēta un pievienota kādam elementam:
     */
    init: function() {
        this.data.originalY = this.el.object3D.position.y;
        this.el.sceneEl.addEventListener('loaded', () => {
            const oceanEl = document.querySelector('a-ocean');
            if (oceanEl && oceanEl.components.ocean) {
                this.data.waveSpeed = oceanEl.components.ocean.data.speed;
            } else {
                console.warn('The `a-ocean` component is not loaded.');
                this.data.waveSpeed = 1;
            }
        });
    },
  
    /**
     * Metode, kas tiek izpildīta katru reizi, kad tiek ģenerēts jauns A-Frame ainas (a-scene) kadrs (frame)
     * 
     * @param {*} time - laiks, kas atbilst A-Frame ainas (a-scene) kopējam renderētajam laikam (ms)
     * @param {*} timeDelta - laiks, kas pagājis starp tagadējo un iepriekšējo kadru (ms)
     */
    tick: function(time, timeDelta) {
        if (this.el.is('dragging')) {
            // Kamēr elements tiek vilkts pa ekrānu, tikmēr neizpildām animāciju:
            return;
        }
        const elapsedTime = time / 1000;  // Sekundes
        const x = this.el.object3D.position.x;
        const z = this.el.object3D.position.z;
        const scaleY = this.el.object3D.scale.y;

        // Pie katra kadra renderēšanas atjauno komponentes vertikālo pozīciju, izmantojot sinusoīda viļņa funkciju - y(t) = A sin(ωt + φ) -, ar dažādām modifikācijām:
        // Šajā gadījumā: 
        //      *) Viļņu garums (amplitūda) A - vidējā starp maksimālo un minimālo amplitūdu
        //      *) Leņķiskā frekvence ω = (viļņu ātrums jeb data.waveSpeed no a-ocean komponentes)
        //      *) Laiks (s) t = (cik ilgi ir pagājis kopš A-Frame aina tika pilnībā renderēta)
        //      *) (x / 0.9) un (z / 0.05) - papildus parametri, kas pielāgoti šai ainai, ar nolūku pieslīpēt animāciju:
        //          *) Mainot konstanti 0.9, 
        //          *) Palielinot konstanti 0.05, strauji palielinās max / min vērtība, līdz kurai iet animācija ( jo)
        //      *) Viļņa fāze φ = scaleY (tā kā objektiem ir atšķirīgi izmēri, tad skatās tās atbilstošo maksimālo y koordinātu no objekta 0-tā punkta - šajā punktā var uzskatīt, ka svārstība ir apstājusies pie t = 0)
        //
        // Beigu rezultāts ir pie oriģinālās 0-tās koordinātas pieskaitīts sinusoīda viļņa funkcijas rezultāts
        const A = (this.data.maxAmplitude - this.data.minAmplitude) / 2;
        const newY = this.data.originalY + (A * Math.sin((this.data.waveSpeed * elapsedTime) + scaleY));
    
        this.el.object3D.position.y = newY;
    }
  });