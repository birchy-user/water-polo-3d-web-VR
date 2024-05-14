// Adaptēts no: "https://cdn.jsdelivr.net/npm/aframe-simple-sun-sky@^1.2.2/simple-sun-sky.js"

// Dokumentācija shader un komponentes izveidei: https://aframe.io/docs/1.5.0/components/material.html#using-a-custom-shader-and-component-together
AFRAME.registerShader('skySunShader', {
    schema: {
        sunPosition: {type: 'vec3', default: {x:1.0, y:1.0, z:1.0}},
        lightColor: {type: 'color', default: '#87cefa'}, // debesu krāsa (gaiši zila)
        darkColor: {type: 'color', default: '#126aab'},  // debesu krāsa (tumši zila)
        sunColor: {type: 'color', default: '#fff7ee'}    // saules krāsa
    },

    vertexShader: `
        varying vec3 vnorm;

        void main() {
            // katras virsotnes (vertex) normāles vektoru (norāda virzienu perpendikulāri ģeometriskajai virsmai šajā virsotnē) nodod tālāk uz "fragmentShader"
            // tiek izmantots, lai noteiktu gaismas kustību pāri šai virsmai (lai to varētu gludāk apgaismot)
            vnorm = normal;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,

    fragmentShader: `
        const float PI = 3.1415926535897932384626433832795;

        // Shader parametri, kas definēti "schema" objektā:
        uniform vec3 sunNormal;
        uniform vec3 lightColor;
        uniform vec3 darkColor;
        uniform vec3 sunColor;

        // "varying" norāda, ka šī mainīgā vērtību saņems no "vertexShader" un pēc tam interpolēs pa attiecīgā ģeometriskā objekta 3D virsmu
        varying vec3 vnorm;

        void main() {
            vec3 norm = normalize(vnorm);

            // Izmantojot formulu leņķa starp diviem vektoriem noteikšanai, var noteikt, kurai krāsai tuvāk ir katra virsotne, atkarībā no tā, kur ģeometriskajā virsmā atrodas saule
            // Jo tālāk saule no virsotnes, jo tumšāka tā būs
            // Tā kā leņķis ir radiānos, tad vērtību dalot ar PI iegūst skaitli robežās [0; 1]
            float interp = acos(dot(norm, sunNormal)) / PI;
            

            // Parametros norādītās krāsas miksē kopā, beigās iegūstot debesu un saules krāsas kopā apvienotas
            const float haloSize = 75.0;        // Jo lielāka vērtība, jo blāvāka saule (krāsa ir vairāk izplūdusi)
            const float sunSizeAdjust = 0.015;  // Mainot šo, mainās saules izmērs
            
            // Iegūst jaunu krāsu, jaucot kopā abas debesu krāsas jeb veicot lineāru interpolāciju starp abām šīm krāsām, izmantojot "interp" interpolācijas virziena noteikšanai
            // Beigu formula: color = lightColor * (1 - interp) + darkColor * interp
            // Rezultāts: beigu krāsa, kas ir tuvāk vienai vai otrai krāsai atkarībā no saules pozīcijas ģeometriskajā virsmā
            // Saite: https://registry.khronos.org/OpenGL-Refpages/gl4/html/mix.xhtml
            vec3 color = mix(lightColor, darkColor, interp);

            // Debesu krāsu sajauc kopā ar saules krāsu - jo tuvāk saulei, jo vairāk pietuvojas tās krāsai (iegūst smuku pāreju no debesīm uz sauli)
            color = mix(sunColor, color, min((interp - sunSizeAdjust)*haloSize, 1.0));  
            gl_FragColor = vec4(color, 1.0);
        }`,

    init: function (data) {
        let sunPos = new THREE.Vector3(data.sunPosition.x, data.sunPosition.y, data.sunPosition.z);
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                lightColor: {value: new THREE.Color(data.lightColor)},
                darkColor: {value: new THREE.Color(data.darkColor)},
                sunNormal: {value: sunPos.normalize()},
                sunColor: {value: new THREE.Color(data.sunColor)}
            },
            vertexShader: this.vertexShader,
            fragmentShader: this.fragmentShader
        });
    },
    /**
     * `update` used to update the material. Called on initialization and when data updates.
     */
    update: function (data) {
        let sunPos = new THREE.Vector3(data.sunPosition.x, data.sunPosition.y, data.sunPosition.z);

        // "Shader" objektam nodod visus parametrus:
        this.material.uniforms.sunNormal.value = sunPos.normalize();

        this.material.uniforms.lightColor.value.set(data.lightColor);
        this.material.uniforms.darkColor.value.set(data.darkColor);
        this.material.uniforms.sunColor.value.set(data.sunColor);
    },
});


AFRAME.registerPrimitive('a-sky-with-sun', {
    defaultComponents: {
        // Debesis + saule ir definētas kā lode ap visu ainu
        geometry: {
            primitive: 'sphere',
            radius: 5000,
            segmentsWidth: 64,
            segmentsHeight: 20
        },
        material: {
            shader: 'skySunShader',
            side: 'back'
        }
    },

    mappings: {
        'sun-position': 'material.sunPosition',
        'light-color': 'material.lightColor',
        'dark-color': 'material.darkColor',
        'sun-color': 'material.sunColor',
        'radius': 'geometry.radius'
    }
});