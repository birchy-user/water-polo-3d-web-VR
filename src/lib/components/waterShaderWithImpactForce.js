// Adaptēts no: https://github.com/mrdoob/three.js/blob/master/examples/webgl_gpgpu_water.html
// Galvenās izmaiņas:
//  1) (TODO) "Shader" objekti ūdens virsmas izmaiņai ņem vērā nevis peles kursoru (kas bija oriģināli), 
//     bet gan datus par kustīgu fizikas objektu, kas lido virsū ūdens virsmai (PROTOTIPS)
//  2) (TODO) Mainīta ūdens krāsa / krāsas izmaiņas, lai vairāk atbilstu baseina ūdenim (gaišāks, lielāks caurspīdīgums)
//  3) Noņemti GUI elementi (parametri ienāk tikai no ārējiem notikumiem, kā bumbas krišana pret ūdens virsmu)

//  4) (TODO) Noņemtas peldošās lodes, pievienota iespēja norādīt citu modeli kā peldošu objektu uz virsmas

import { THREE } from '../fix-dependencies/aframe';

import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

import { heightMapFragmentShader } from '../shaders/water/heightmapFragmentShader.js';
import { smoothFragmentShader } from '../shaders/water/smoothFragmentShader';
import { readWaterLevelFragmentShader } from '../shaders/water/readWaterLevelFragmentShader';
import { waterVertexShader } from '../shaders/water/vertexShader';

// Tekstūras platums
const TEXTURE_WIDTH = 256;

// Ūdens virsmas izmērs (512 x 512)
const WATER_SURFACE_SIZE = 1024;
const WATER_SURFACE_SIZE_HALF = WATER_SURFACE_SIZE * 0.5;

const NUM_SPHERES = 5;

const simplex = new SimplexNoise();

/**
 * 
 * @param {Object} effectController - sākotnējie 
 * @param {*} scene 
 * @param {*} renderer 
 * @param {*} spheresEnabled 
 * @returns 
 */
export const initWater = (
    effectController,
    scene,
    renderer,
    spheresEnabled
) => {
    let water;
    let meshRay;
    let gpuCompute;
    let heightmapVariable;
    let waterUniforms;
    let smoothShader;
    let readWaterLevelShader;
    let readWaterLevelImage;
    let readWaterLevelRenderTarget;
    let spheres = [];
    const waterNormal = new THREE.Vector3();

    // Izveido jaunu "Shader" materiālu, kopējot "MeshPhongMaterial" materiālu no https://threejs.org/docs/#api/en/materials/MeshPhongMaterial
    // Iegūtā materiāla virsotnes apstrādā ar atsevišķo "waterVertexShader" objektu, kas definēts failā `../shaders/water/vertexShader`
    // Daļiņu ("fragment") "shader" nosaka, kādā krāsā jāiekrāso katra virsmas (3D objekta) daļa (šajā gadījumā izmanto "meshphong_frag" no https://github.com/mrdoob/three.js/blob/master/src/renderers/shaders/ShaderLib/meshphong.glsl.js)

    // TODO: Iekļaut aprakstu no https://threejs.org/docs/#api/en/materials/ShaderMaterial par "shader" pamatiem
    const material = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([
            THREE.ShaderLib['phong'].uniforms,
            {
                'heightmap': { value: null }
            }
        ]),
        vertexShader: waterVertexShader,
        fragmentShader: THREE.ShaderChunk['meshphong_frag']
    });

    // Sniedz iespēju "vertex shader" nodot datus par materiāla apgaismojumu
    material.lights = true;

    // Material attributes from THREE.MeshPhongMaterial
    // Sets the uniforms with the material values
    // Nosaka "MeshPhongMaterial" materiāla īpašības (atstarošanās, spīdīgums, necaurspīdīgums)
    material.uniforms['diffuse'].value = new THREE.Color(0x55AAFF); // Gaiši zila krāsa
    material.uniforms['specular'].value = new THREE.Color(0x111111);
    material.uniforms['shininess'].value = 50;
    material.uniforms['opacity'].value = 0.5;
    material.transparent = true;
    
    // Objekti (atslēgas/vērtības pāri), kuri tiks nodoti gan virsotņu ("vertex"), gan daļiņu ("fragment") nokrāsotājiem jeb "shader"
    // Abos "shader" objektos tos varēs izmantot kā mainīgos ar konstantām, atsaucoties uz definētajām atslēgām
    // Piemērs: { PI: Math.PI, TEXTURE_WIDTH: 12.5, ... }
    material.defines.TEXTURE_WIDTH = TEXTURE_WIDTH.toFixed(1);
    material.defines.WATER_SURFACE_SIZE = WATER_SURFACE_SIZE.toFixed(1);

    // "Uniforms" ir mainīgie, kuru vērtības var nodot no programmas uz "shader" objektu
    waterUniforms = material.uniforms;

    // Pamata ūdens ģeometrija
    const waterGeometry = new THREE.PlaneGeometry(WATER_SURFACE_SIZE, WATER_SURFACE_SIZE, TEXTURE_WIDTH - 1, TEXTURE_WIDTH - 1);
    water = new THREE.Mesh(waterGeometry, material);
    water.rotation.x = - Math.PI / 2;
    water.matrixAutoUpdate = false;
    water.updateMatrix();

    scene.add(water);

    // Neredzama, statiska plakne pāri visai ūdens virsmai, kas uztver peles kursoru
    const raycastGeometry = new THREE.PlaneGeometry(WATER_SURFACE_SIZE, WATER_SURFACE_SIZE, 1, 1);
    meshRay = new THREE.Mesh(raycastGeometry, new THREE.MeshBasicMaterial({ color: 0xFFFFFF, visible: false }));
    meshRay.rotation.x = - Math.PI / 2;
    meshRay.matrixAutoUpdate = false;
    meshRay.updateMatrix();
    scene.add(meshRay);

    // Uzstāda GPU skaitļošanas klasi, kas izpildīs nepieciešamos aprēķinus (uzstādīšanas procesu skatīt: https://github.com/supermedium/three.js/blob/dev/examples/jsm/misc/GPUComputationRenderer.js)
    // 1. Izveido renderētāju
    gpuCompute = new GPUComputationRenderer(TEXTURE_WIDTH, TEXTURE_WIDTH, renderer);

    // 2. Definē "tukšu" sākotnējo tekstūru 128 x 128 izmērā, to aizpildot ar 32-bitu skaitļu masīvu (128*4 x 128*4), kur katrs elements = 0
    // Rezultātā iegūst 128 x 128 tekstūru, kas atbilst melnai krāsai
    const heightmap0 = gpuCompute.createTexture();

    // 3. Tukšo tekstūru aizpilda ar datiem
    fillTexture(heightmap0);

    // 4. Definē "heightmap" tekstūras mainīgo, kas nosaka ūdens virsmas augstumu dažādos fragmentos (simulē viļņus)
    heightmapVariable = gpuCompute.addVariable('heightmap', heightMapFragmentShader, heightmap0);

    // 5. Viļņu augstuma mainīgās vērtības atkarības definēšana
    gpuCompute.setVariableDependencies(heightmapVariable, [heightmapVariable]);

    // 6. "Uniforms" mainīgo noklusējuma vērtības, kurus nodos "shader" objektam 
    // šajā gadījumā tiek nodoti tādi parametri viļņa augstuma aprēķināšanai, kas nodrošina, ka animācija sākas ar kustību un lēnām samazinās
    // TODO: mainīt šo uz atkarību no bumbas lidošanas ātruma / impulsa
    heightmapVariable.material.uniforms['mousePos'] = { value: new THREE.Vector2(10000, 10000) };
    heightmapVariable.material.uniforms['mouseSize'] = { value: 20.0 };
    heightmapVariable.material.uniforms['viscosityConstant'] = { value: 0.98 };
    heightmapVariable.material.uniforms['heightCompensation'] = { value: 0 };
    heightmapVariable.material.defines.WATER_SURFACE_SIZE = WATER_SURFACE_SIZE.toFixed(1);

    // 7. Pārbauda, vai ir iespējams veikt aprēķinus, izmantojot GPU
    // Ja GPU nav pieejams / nevar izpildīt aprēķinus, tiek atgriezta īpaša kļūda
    const error = gpuCompute.init();
    if (error !== null) {
        console.error(error);
    }

    // Create compute shader to smooth the water surface and velocity
    // "Shader", kas "nomierina" ūdens virsmu, pakāpeniski katrā kadrā samazinot tās krāsas deformācijas
    // smoothShader = gpuCompute.createShaderMaterial(smoothFragmentShader, { smoothTexture: { value: null } });

    // Tiek izveidots ūdens līmeņa nolasīšanas "shader", kas katrā ūdens virsmas daļā nosaka, cik augstu ir pacelta ūdens virsma
    readWaterLevelShader = gpuCompute.createShaderMaterial(readWaterLevelFragmentShader, {
        point1: { value: new THREE.Vector2() },
        levelTexture: { value: null }
    });
    readWaterLevelShader.defines.TEXTURE_WIDTH = TEXTURE_WIDTH.toFixed(1);
    readWaterLevelShader.defines.WATER_SURFACE_SIZE = WATER_SURFACE_SIZE.toFixed(1);

    // Izveido 4x1 pikseļa attēlu un renderēšanas mērķobjektu (4 kanāli, 1 baits kanālā), ar kura palīdzību var nolasīt ūdens augstumu un virzienu
    // Tas tiek izmantots kā buferis, kurā fonā tiek veikta pirmsrenderēšanas aprēķini
    // Avots: https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget
    readWaterLevelImage = new Uint8Array(4 * 1 * 4);
    readWaterLevelRenderTarget = new THREE.WebGLRenderTarget(4, 1, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false
    });

    spheres = createSpheres(scene);

    heightmapVariable.material.uniforms['mouseSize'].value = effectController.mouseSize;
    heightmapVariable.material.uniforms['viscosityConstant'].value = effectController.viscosity;
    spheresEnabled = effectController.spheresEnabled;
    for (let i = 0; i < NUM_SPHERES; i ++) {
        if (spheres[i]) {
            spheres[i].visible = spheresEnabled;
        }
    }

    return {
        gpuCompute,
        heightmapVariable,
        waterUniforms,
        smoothShader,
        readWaterLevelShader,
        readWaterLevelImage,
        readWaterLevelRenderTarget,
        spheres,
        water,
        meshRay,
        waterNormal
    };
}

// Aizpilda tekstūru, izmantojot 2D "Simplex Noise" trokšņa ģenerēšanas algoritmu (https://en.wikipedia.org/wiki/Simplex_noise)
const fillTexture = (texture) => {
    const waterMaxHeight = 10;

    const noise = (x, y) => {
        let multR = waterMaxHeight;
        let mult = 0.025;
        let r = 0;
        for (let i = 0; i < 15; i ++) {
            r += multR * simplex.noise(x * mult, y * mult);
            multR *= 0.53 + 0.025 * i;
            mult *= 1.25;
        }

        return r;
    }

    const pixels = texture.image.data;

    // Ienākošā tekstūra ir 128 x 128 izmērā, katru vērtību aizpilda ar citu trokšņainu vērtību,
    // izmantojot Simplex Noise algoritma pamata ideju, kas ietver procesu, kurā katrai virsotnei (pikselim) aprēķina tās atbilstošo četrstūri (no tuvākajām četrām virsotnēm)    
    // Rezultātā iegūst datus, kas atbilst trokšņainam gradientam, kas sastāv no dažāda izmēra četrstūriem, kas pārvilkti pāri astoņstūriem
    let p = 0;
    for (let j = 0; j < TEXTURE_WIDTH; j ++) {
        for (let i = 0; i < TEXTURE_WIDTH; i ++) {
            const x = i * 128 / TEXTURE_WIDTH;
            const y = j * 128 / TEXTURE_WIDTH;

            pixels[p + 0] = noise(x, y);
            pixels[p + 1] = pixels[p + 0];
            pixels[p + 2] = 0;
            pixels[p + 3] = 1;

            p += 4;

        }

    }

}

const createSpheres = (scene) => {
    const spheres = [];

    const sphereTemplate = new THREE.Mesh(new THREE.SphereGeometry(4, 24, 12), new THREE.MeshPhongMaterial({ color: 0xFFFF00 }));

    for (let i = 0; i < NUM_SPHERES; i ++) {

        let sphere = sphereTemplate;
        if (i < NUM_SPHERES - 1) {

            sphere = sphereTemplate.clone();

        }

        sphere.position.x = (Math.random() - 0.5) * WATER_SURFACE_SIZE * 0.7;
        sphere.position.z = (Math.random() - 0.5) * WATER_SURFACE_SIZE * 0.7;

        sphere.userData.velocity = new THREE.Vector3();

        scene.add(sphere);

        spheres[i] = sphere;

    }

    return spheres;

}

export const sphereDynamics = (
    renderer,
    gpuCompute,
    heightmapVariable,
    readWaterLevelShader,
    readWaterLevelRenderTarget,
    readWaterLevelImage,
    waterNormal,
    spheres
) => {

    const currentRenderTarget = gpuCompute.getCurrentRenderTarget(heightmapVariable);

    readWaterLevelShader.uniforms['levelTexture'].value = currentRenderTarget.texture;

    for (const sphere of spheres) {
        if (sphere) {
            // Read water level and orientation
            const u = 0.5 * sphere.position.x / WATER_SURFACE_SIZE_HALF + 0.5;
            const v = 1 - (0.5 * sphere.position.z / WATER_SURFACE_SIZE_HALF + 0.5);
            readWaterLevelShader.uniforms['point1'].value.set(u, v);
            gpuCompute.doRenderTarget(readWaterLevelShader, readWaterLevelRenderTarget);

            renderer.readRenderTargetPixels(readWaterLevelRenderTarget, 0, 0, 4, 1, readWaterLevelImage);
            const pixels = new Float32Array(readWaterLevelImage.buffer);

            // Get orientation
            waterNormal.set(pixels[1], 0, - pixels[2]);

            const pos = sphere.position;
            pos.y = pixels[0];

            // Move sphere
            waterNormal.multiplyScalar(0.1);
            sphere.userData.velocity.add(waterNormal);
            sphere.userData.velocity.multiplyScalar(0.998);
            pos.add(sphere.userData.velocity);

            if (pos.x < - WATER_SURFACE_SIZE_HALF) {
                pos.x = - WATER_SURFACE_SIZE_HALF + 0.001;
                sphere.userData.velocity.x *= - 0.3;
            } else if (pos.x > WATER_SURFACE_SIZE_HALF) {
                pos.x = WATER_SURFACE_SIZE_HALF - 0.001;
                sphere.userData.velocity.x *= - 0.3;
            }

            if (pos.z < - WATER_SURFACE_SIZE_HALF) {
                pos.z = - WATER_SURFACE_SIZE_HALF + 0.001;
                sphere.userData.velocity.z *= - 0.3;
            } else if (pos.z > WATER_SURFACE_SIZE_HALF) {
                pos.z = WATER_SURFACE_SIZE_HALF - 0.001;
                sphere.userData.velocity.z *= - 0.3;
            }
        }
    }
}