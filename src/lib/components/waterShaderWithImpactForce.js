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

// Visi ūdens virsmas mainīšanai nepieciešamie "shader" objekti:
import { heightMapFragmentShader } from '../shaders/water/heightmapFragmentShader.js';
import { smoothFragmentShader } from '../shaders/water/smoothFragmentShader';
import { readWaterLevelFragmentShader } from '../shaders/water/readWaterLevelFragmentShader';
import { waterVertexShader } from '../shaders/water/vertexShader';

// Tekstūras platums
const TEXTURE_WIDTH = 256;

// Ūdens virsmas izmērs (512 x 512)
const WATER_SURFACE_SIZE = 1024;
const WATER_SURFACE_SIZE_HALF = WATER_SURFACE_SIZE * 0.5;

// Nolasāmā pikseļa reģions:
const PIXEL_REGION_WIDTH = 4;
const PIXEL_REGION_HEIGHT = 1;

const simplex = new SimplexNoise();

/**
 * Izveido jaunu ūdens virsmu, 
 * 
 * @param {Object} effectController - sākotnējie parametri: peles koordinātas un ūdens stigrība (viskozitāte jeb "viscosity")
 * @param {*} scene - Three.js 3D ainas objekts (galvenā aina, kur viss tiek ievietots iekšā)
 * @param {*} renderer - 3D ainas renderētājs
 * @returns dažādi objekti kā ūdens virsmas, GPU aprēķināšanas objekts, ūdens līmeņa un viļņu augstuma "shader" u.c.
 */
export const initWater = (
    effectController,
    scene,
    renderer
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

    // Izveido jaunu "Shader" materiālu, kopējot "MeshPhongMaterial" materiālu no https://threejs.org/docs/#api/en/materials/MeshPhongMaterial
    // Iegūtā materiāla virsotnes apstrādā ar atsevišķo "waterVertexShader" objektu, kas definēts failā `../shaders/water/vertexShader`
    // Daļiņu ("fragment") "shader" nosaka, kādā krāsā jāiekrāso katra virsmas (3D objekta) daļa (šajā gadījumā izmanto "meshphong_frag" no https://github.com/mrdoob/three.js/blob/master/src/renderers/shaders/ShaderLib/meshphong.glsl.js)
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

    // Nosaka "MeshPhongMaterial" materiāla konstantās īpašības (atstarošanās, spīdīgums, necaurspīdīgums)
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

    // 2. Definē "tukšu" sākotnējo tekstūru TEXTURE_WIDTH x TEXTURE_WIDTH izmērā, to aizpildot ar 32-bitu skaitļu masīvu (TEXTURE_WIDTH*4 x TEXTURE_WIDTH*4), kur katrs elements = 0
    const heightmap0 = gpuCompute.createTexture();

    // 3. Tukšo tekstūru aizpilda ar datiem
    fillTexture(heightmap0);

    // 4. Definē "heightmap" tekstūras mainīgo, kas nosaka ūdens virsmas augstumu dažādos fragmentos (simulē viļņus), izmantojot iepriekš aizpildīto tukšo bāzes tekstūru kā sākuma stāvokli
    // Katrs mainīgais atbilst RGBA peldošā punkta tipa tekstūras, kas satur 4 peldošā punkta skaitļus katram aprēķinātajam elementam jeb tekselim ("texel", tekstūras pikselis)
    // Katram mainīgajam ir "fragment shader", kas definē nepieciešamās skaitļošanas darbības mainīgā iegūšanai un izmantošanai iekš "fragment shader"
    heightmapVariable = gpuCompute.addVariable('heightmap', heightMapFragmentShader, heightmap0);

    // 5. Viļņu augstuma mainīgās vērtības tekstūras atkarības definēšana (parasti mainīgajiem tā vispirms ir saistība ar sevi pašu)
    // Mainīgajam var norādīt citas atkarības, tādā veidā nodrošinot, ka tās
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

    // "Shader", kas "nomierina" ūdens virsmu, pakāpeniski katrā kadrā samazinot tās krāsas deformācijas
    // smoothShader = gpuCompute.createShaderMaterial(smoothFragmentShader, { smoothTexture: { value: null } });

    // Tiek izveidots ūdens līmeņa nolasīšanas "shader", kas katrā ūdens virsmas daļā nosaka, cik augstu ir pacelta ūdens virsma
    readWaterLevelShader = gpuCompute.createShaderMaterial(readWaterLevelFragmentShader, {
        point1: { value: new THREE.Vector2() },
        levelTexture: { value: null }
    });
    readWaterLevelShader.defines.TEXTURE_WIDTH = TEXTURE_WIDTH.toFixed(1);
    readWaterLevelShader.defines.WATER_SURFACE_SIZE = WATER_SURFACE_SIZE.toFixed(1);

    // Izveido 4x1 pikseļa attēlu un renderēšanas mērķobjektu (4 kanāli, 1 baits kanālā), ar kura palīdzību var attēlot un mainīt pikseļus tekstūrā nevis pašā ainā ("canvas") tiešā veidā
    // Tas tiek izmantots kā buferis, kurā tiek veikti pirmsrenderēšanas aprēķini (ievietoti ūdens līmeņa aprēķina rezultējošie pikseļi)
    // Avots: https://threejs.org/docs/#api/en/renderers/WebGLRenderTarget
    readWaterLevelImage = new Uint8Array(PIXEL_REGION_WIDTH * PIXEL_REGION_HEIGHT * 4);
    readWaterLevelRenderTarget = new THREE.WebGLRenderTarget(PIXEL_REGION_WIDTH, PIXEL_REGION_HEIGHT, {
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        format: THREE.RGBAFormat,
        type: THREE.UnsignedByteType,
        depthBuffer: false
    });

    heightmapVariable.material.uniforms['mouseSize'].value = effectController.mouseSize;
    heightmapVariable.material.uniforms['viscosityConstant'].value = effectController.viscosity;

    return {
        gpuCompute,
        heightmapVariable,
        waterUniforms,
        smoothShader,
        readWaterLevelShader,
        readWaterLevelImage,
        readWaterLevelRenderTarget,
        water,
        meshRay
    };
}

/**
 * Aizpilda tekstūru, izmantojot 2D "Simplex Noise" trokšņa ģenerēšanas algoritmu (https://en.wikipedia.org/wiki/Simplex_noise)
 *
 * @param {*} texture - tekstūras objekts
 */
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

    // Ienākošā tekstūra ir TEXTURE_WIDTH x TEXTURE_WIDTH izmērā, katru vērtību aizpilda ar jaunu trokšņainu vērtību,
    // izmantojot Simplex Noise algoritma pamata ideju, kas ietver procesu, kurā katrai virsotnei (pikselim) aprēķina tās atbilstošo četrstūri (no tuvākajām četrām virsotnēm)    
    // Rezultātā iegūst tekstūru, kas atbilst trokšņainai ūdens virsmai, simulējot viļņus dažādos augstumos un pozīcijās (atbilstoši Simplex Noise trokšņa algoritmam)
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

/**
 * Nolasa ūdens līmeni katrā ūdens virsmas punktā, no tā nosaka, 
 * cik tālu vajag kustināt peldošos objektus (`floatingObjects`), 
 * balstoties pēc to pozīcijas un ūdens līmeņa izmaiņām (atkarībā no radītajiem viļņiem)
 * 
 * @param {*} renderer - 3D ainas renderētājs
 * @param {*} gpuCompute - GPU aprēķinu izpildīšanas objekts
 * @param {*} heightmapVariable - ūdens viļņu augstuma tekstūra, kas nosaka, cik augstu paceļas vilnis katrā ūdens līmeņa tekstūras tekselī
 * @param {*} readWaterLevelShader - daļinu ēnotājs jeb "fragment shader", kas uztver un reģistrē izmaiņas ūdens līmeņa tekstūrā (nosaka, kā jāmaina katrs tekstūras tekselis atbilstoši izmaiņām ūdens virsmā)
 * @param {*} readWaterLevelRenderTarget - ūdens līmeņa tekstūras renderēšanas mērķobjekts, ar kura palīdzību attēlo izmaiņas pa tiešo tā tekstūrā 
 * @param {*} readWaterLevelImage - buferis, pēc kura nolasa ūdens līmeni katrā ūdens līmeņa tekstūras tekselī ("texel")
 * @param {*} waterNormal - normāles vektors, kas norāda uz ūdens virsmas centru (0, 0, 0)
 * @param {*} floatingObjects - peldošie objekti
 * @param {*} floatingObjectsWithBodies - peldošo objektu atbilstošie fiziskās pasaules ķermeņi
 */
export const sphereDynamics = (
    renderer,
    gpuCompute,
    heightmapVariable,
    readWaterLevelShader,
    readWaterLevelRenderTarget,
    readWaterLevelImage,
    waterNormal,
    floatingObjects,
    floatingObjectsWithBodies
) => {

    // Iegūst "heightmap" mainīgā GPU renderētājā iegūto rezultātu, to izmanto, lai atjaunotu ūdens virsmas līmeņa tekstūru nākošajā kadrā
    readWaterLevelShader.uniforms['levelTexture'].value = gpuCompute.getCurrentRenderTarget(heightmapVariable).texture;

    for (const obj of floatingObjects) {
        if (obj) {
            const physicalBody = floatingObjectsWithBodies[obj.name];

            if (!physicalBody || obj.userData.collidedWithGoal || obj.userData.isDragging) { 
                continue;
            }

            // Nolasa peldošā objekta koordinātas ūdens virsmā, tās izmanto kā atskaites punktu, pēc kura nosaka, kurā vietā ūdens līmeņa tekstūrā tiks renderēts vilnis 
            const x = 0.5 * physicalBody.position.x / WATER_SURFACE_SIZE_HALF + 0.5;
            const z = 1 - (0.5 * physicalBody.position.z / WATER_SURFACE_SIZE_HALF + 0.5);
            readWaterLevelShader.uniforms['point1'].value.set(x, z);
            
            // Pirms kadra renderēšanas no iepriekšējā kadra paņem ūdens līmeni, pēc tā aprēķina, kāds būs ūdens līmenis un tā orientācija šajā kadrā, to ievieto ūdens līmeņa renderēšanas mērķobjektā
            gpuCompute.doRenderTarget(readWaterLevelShader, readWaterLevelRenderTarget);

            // Nolasa datus par pikseļu krāsām noteiktā reģionā (4 x 1 jeb četrstūrī) ūdens līmeņa renderēšanas mērķobjektā un tos ievieto iekšā `readWaterLevelImage` buferī
            // To izmanto, lai pašreizējā kadrā no "shader" iegūtu pikseļu vērtības
            renderer.readRenderTargetPixels(
                readWaterLevelRenderTarget, // No kurienes ielasa datus (ņem iepriekšējā kadrā renderēto ūdens līmeni)
                0,                          // pirmais apakšējā-kreisā stūra horizontālais pikselis, no kura sāk nolasīšanu
                0,                          // pirmais apakšējā-kreisā stūra vertikālais pikselis, no kura sāk nolasīšanu
                PIXEL_REGION_WIDTH,         // nolasāmā reģiona platums
                PIXEL_REGION_HEIGHT,        // nolasāmā reģiona augstums
                readWaterLevelImage         // bufera objekts, kurā ievietos visus nolasītā ūdens līmeņa reģiona pikseļus RGBA formātā
            );

            // Buferis, kas satur ūdens līmeņa renderēšanas mērķobjekta pikseļu vērtības RGBA formātā (pixels[0] = R, pixels[1] = G, pixels[2] = B, pixels[3] = A (alpha jeb caurspīdīgums))
            // Šajā gadījumā: 
            //      *) pixels[0] = <ūdens līmeņa y noteiktā punktā>
            //      *) pixels[1] = <ūdens līmeņa x noteiktā punktā>
            //      *) pixels[2] = <ūdens līmeņa z noteiktā punktā>
            //      *) pixels[3] = (neizmantots)
            const pixels = new Float32Array(readWaterLevelImage.buffer);

            // Iegūst virzienu, kurā pēc peles kustināšanas tiek virzīts peldošais objekts
            waterNormal.set(pixels[1], 0, - pixels[2]);

            const pos = physicalBody.position;
            physicalBody.position.y = pixels[0];

            // Kustina peldošo objektu par 0.1 vienībām attiecīgajā virzienā
            waterNormal.scale(0.1);  // skalāri pareizina normāles vektoru ar 0.1
            physicalBody.velocity.vadd(waterNormal, physicalBody.velocity);  // physicalBody.velocity = physicalBody.velocity + waterNormal (saskaita abus vektorus)
            physicalBody.velocity.scale(0.998);  // apslāpē kustību
            pos.vadd(physicalBody.velocity);

            // Peldošais objekts atsitās pret ūdens virsmas beigu robežu, pabīda to nedaudz uz pretējo virzienu
            if (pos.x < - WATER_SURFACE_SIZE_HALF) {
                // uz leju
                pos.x = - WATER_SURFACE_SIZE_HALF + 0.001;
                physicalBody.velocity.x *= - 0.3;
            } else if (pos.x > WATER_SURFACE_SIZE_HALF) {
                // uz augšu
                pos.x = WATER_SURFACE_SIZE_HALF - 0.001;
                physicalBody.velocity.x *= - 0.3;
            }

            // Peldošais objekts atsitās pret ūdens virsmas beigu robežu, pabīda to nedaudz uz pretējo virzienu
            if (pos.z < - WATER_SURFACE_SIZE_HALF) {
                // pa kreisi
                pos.z = - WATER_SURFACE_SIZE_HALF + 0.001;
                physicalBody.velocity.z *= - 0.3;
            } else if (pos.z > WATER_SURFACE_SIZE_HALF) {
                // pa labi
                pos.z = WATER_SURFACE_SIZE_HALF - 0.001;
                physicalBody.velocity.z *= - 0.3;
            }
        }
    }
}