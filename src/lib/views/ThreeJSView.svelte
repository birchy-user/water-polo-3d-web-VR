<script>
    import { onMount } from 'svelte';

    import { THREE, CANNON } from '../fix-dependencies/aframe';
    import CannonDebugger from 'cannon-es-debugger';
    import { threeToCannon, ShapeType } from 'three-to-cannon';

    import { OrbitControls } from 'super-three/addons/controls/OrbitControls.js';
    import Stats from 'super-three/addons/libs/stats.module.js';

    // 3D objekti:
    import { Sky } from 'super-three/addons/objects/Sky.js';

    import { GPUComputationRenderer } from 'super-three/addons/misc/GPUComputationRenderer.js';
    import { SimplexNoise } from 'super-three/addons/math/SimplexNoise.js';

    // Visi ūdens virsmas mainīšanai nepieciešamie "shader" objekti:
    import { heightMapFragmentShader } from '../shaders/water/heightmapFragmentShader.js';
    import { smoothFragmentShader } from '../shaders/water/smoothFragmentShader';
    import { readWaterLevelFragmentShader } from '../shaders/water/readWaterLevelFragmentShader';
    import { waterVertexShader } from '../shaders/water/vertexShader';

    import { initWater, sphereDynamics } from '../components/waterShaderWithImpactForce';

    let scene; 
    let camera;
    let renderer;

    let water;
    let isWaterRendered = false;
    let waterPhysicalBody;

    let container;

    let controls;
    
    // Saules un debesu parametri:
    const parameters = {
        elevation: 0.5,
        azimuth: 180
    };

    let stats;
    let loadingContainer;

    // ŪDENS SHADER IZVEIDES PARAMETRI:
    let mouseMoved = false;

    // Peles kursora koordinātas NDC (normalizētā) formātā (x, y), vērtības robežās [-1; 1], kuras padod staru izstarotājam ("raycaster")
    // NDC avots: https://learnopengl.com/Getting-started/Coordinate-Systems
    // Tās aprēķina, ņemot peles kursora atrašanās vietu relatīvi renderētās ainas robežām, un normalizējot iegūtās vērtibas
    const mouseCoords = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    let meshRay;

    /** @type {GPUComputationRenderer} */
    let gpuCompute;

    let heightmapVariable;
    let waterUniforms;
    let smoothShader;
    let readWaterLevelShader;
    let readWaterLevelRenderTarget;
    let readWaterLevelImage;
    let waterNormal = new THREE.Vector3();

    let spheres = [];
    let spheresEnabled = true;

    const simplex = new SimplexNoise();

    const effectController = {
        mouseSize: 20.0,
        viscosity: 0.98,
        spheresEnabled: spheresEnabled
    };

    // Fizikas pasaule:
    let cannonDebugger;
    let physicsWorld;

    // 3D modeļu objekti, fiziskie ķermeņi:
    let waterPoloBall;
    let waterPoloBallBody;      // Bumbas fiziskais modelis

    let waterPoloGoalNet;
    let goalNetMesh;            // Vārtu rāmis ar tīklu
    let crossbarWithPostsMesh;  // Vārtu augšējais stabs un sānu stabi
    let netFrameMesh;           // Balsti, kas savieno tīklu ar stabiem
    
    let waterPoloGoalNetBody;   // Vārtu fiziskais modelis
    
    let swimmingPool;
    let swimmingPoolBody;

    // Modeļu ielāde:
    const modelLoader = (loader, url) => {
        return new Promise((resolve, reject) => {
            loader.load(url, data => resolve(data), null, reject);
        })
    };

    const updateSun = () => {
        // Saule:
        let sun = new THREE.Vector3();

        // Debesis:
        const sky = new Sky();
        sky.scale.setScalar(10000);
        scene.add(sky);

        const skyUniforms = sky.material.uniforms;
        skyUniforms['turbidity'].value = 10;
        skyUniforms['rayleigh'].value = 2;
        skyUniforms['mieCoefficient'].value = 0.005;
        skyUniforms['mieDirectionalG'].value = 0.8;

        let renderTarget;
        let pmremGenerator = new THREE.PMREMGenerator(renderer);
        let sceneEnv = new THREE.Scene();

        const phi = THREE.MathUtils.degToRad(90 - parameters.elevation);
        const theta = THREE.MathUtils.degToRad(parameters.azimuth);

        sun.setFromSphericalCoords(1, phi, theta);

        sky.material.uniforms['sunPosition'].value.copy(sun);

        sceneEnv.add(sky);
        renderTarget = pmremGenerator.fromScene(sceneEnv);
        scene.add(sky);

        scene.environment = renderTarget.texture;
    };

    // Definē ainas fizisko pasauli, izmantojot Cannon.js
    // Fiziskās pasaules objektus jāspēj sasaistīt kopā ar renderētajiem (vizuāli redzamajiem) objektiem
    const initPhysics = () => {
        // Fiziskās pasaules īpašības
        physicsWorld = new CANNON.World({
            gravity: new CANNON.Vec3(0, -9.81, 0),
        });

        // objektu sadursmes materiāli:
        const ballMaterial = new CANNON.Material();
        const goalNetMaterial = new CANNON.Material();

        const ballGoalContactMaterial = new CANNON.ContactMaterial(ballMaterial, goalNetMaterial, {
            restitution: 0.9, // Jo augstāka restitūcija, jo spēcīgāk atsitas pret citu virsmu, ar kuru saduras
            friction: 0.3     // Berze
        });

        physicsWorld.addContactMaterial(ballGoalContactMaterial);

        cannonDebugger = new CannonDebugger(scene, physicsWorld);

        if (isWaterRendered) {
            // Ūdens virsmas fiziskais modelis ir nekustīga statiska plakne, kas nelaiž cauri objektus (citādi tas negatīvi ietekmē to animāciju pa ūdens virsmu)
            waterPhysicalBody = new CANNON.Body({
                type: CANNON.Body.STATIC,
                shape: new CANNON.Plane()
            });

            // Avots: https://schteppe.github.io/cannon.js/docs/classes/Quaternion.html
            // "Quaternion" (Q) apraksta rotāciju 3D telpā, kas matetmātiski ir aprakstīta ar formulu: Q = x*i + y*j + z*k + w, kur
            //      *) i, j, k ir komplekso skaitļu bāzes vektori
            //      *) (x, y, z) - reālo skaitļu bāzes vektors, kas saistīts ar rotācijas asīm 
            //      *) w - rotācijas skala (cik daudz rotācijas tiek izpildītas), 0 nozīmē, ka tiek izpildīta viena rotācija
            waterPhysicalBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
            waterPhysicalBody.position.set(0, 0, 0);

            physicsWorld.addBody(waterPhysicalBody);
        }

        if (waterPoloBall) {
            console.log(`waterPoloBall`, waterPoloBall);
            // Ūdenspolo bumbas fiziskais modelis
            const ballRadius = 5; 
            waterPoloBallBody = new CANNON.Body({
                mass: 5,
                shape: new CANNON.Sphere(ballRadius),
                position: new CANNON.Vec3(0, 10, 0),
                material: ballMaterial
            });

            // Lai noteiktu pareizu kustību, vajag sekot līdzi, kad bumba saskārās ar vārtu objektu:
            waterPoloBall.userData.collidedWithGoal = false;

            physicsWorld.addBody(waterPoloBallBody);
        }

        if (waterPoloGoalNet) {
            // Vārtu modeļa sastāvdaļu izmēri (dimensijas) jeb "bounding box"
            const backNetMeshBbox = new THREE.Box3().setFromObject(goalNetMesh);
            const postsBbox = new THREE.Box3().setFromObject(crossbarWithPostsMesh);
            const upperNetMeshBbox = new THREE.Box3().setFromObject(netFrameMesh);

            console.log("goal back net ", goalNetMesh);
            console.log("crossbar and posts: ", crossbarWithPostsMesh);
            console.log("goal frame ", netFrameMesh);

            // Konstruē fizisko modeli vārtiem un tā sastāvdaļām:
            waterPoloGoalNetBody = new CANNON.Body({ 
                mass: 0,
                position: new CANNON.Vec3(-250, 1, 0),
                material: goalNetMaterial
            });
            
            console.log("backNetMeshBbox", backNetMeshBbox);
            console.log("postsBbox", postsBbox);
            console.log("upperNetMeshBbox", upperNetMeshBbox);
            
            // 1. VĀRTU AIZMUGURĒJAIS RĀMIS
            const backNetX = 1;
            const backNetXOffset = -10;
            const backNetY = (backNetMeshBbox.max.y - backNetMeshBbox.min.y) / 2;
            const backNetZ = (backNetMeshBbox.max.z - backNetMeshBbox.min.z) / 2;

            const backNetShape = new CANNON.Box(new CANNON.Vec3(backNetX, backNetY, backNetZ));
            const backNetPosition = new CANNON.Vec3(backNetXOffset, backNetY, 0);

            waterPoloGoalNetBody.addShape(backNetShape, backNetPosition);

            
            // 2. VĀRTU STABI (kreisais un labais vārtu stabs + augšējais vārtu stabs)

            const postsX = (postsBbox.max.x - postsBbox.min.x) / 2;  // Dala ar 2, jo jāiegūst vidus punkts katrā objekta iekšējās pasaules asī
            const postsY = (postsBbox.max.y - postsBbox.min.y) / 2;
            const postsZ = (postsBbox.max.z - postsBbox.min.z) / 2;
            const postZOffset = postsZ / 3.15;

            const leftPostShape = new CANNON.Box(new CANNON.Vec3(postsX, postsY, postsX));
            const rightPostShape = new CANNON.Box(new CANNON.Vec3(postsX, postsY, postsX));
            
            const leftPostCenterOffset = new CANNON.Vec3(postsZ - postZOffset, postsY, -postsZ); // +z līdz galam
            const rightPostCenterOffset = new CANNON.Vec3(postsZ - postZOffset, postsY, postsZ); // -z līdz galam
            
            const topCrossbarThickness = 6;
            const topCrossbarShape = new CANNON.Box(new CANNON.Vec3(postsX, topCrossbarThickness, postsZ));
            const topCrossbarCenterOffset = new CANNON.Vec3(postsZ - postZOffset, postsY * 2 - topCrossbarThickness, 0);
            
            waterPoloGoalNetBody.addShape(leftPostShape, leftPostCenterOffset);
            waterPoloGoalNetBody.addShape(rightPostShape, rightPostCenterOffset);
            waterPoloGoalNetBody.addShape(topCrossbarShape, topCrossbarCenterOffset);

            
            // 3. AUGŠĒJAIS TĪKLS (starp aizmuguri un augšējo vārtu stabu)
            
            const upperNetX = (upperNetMeshBbox.max.x - upperNetMeshBbox.min.x) / 2;
            const upperNetY = (upperNetMeshBbox.max.y - upperNetMeshBbox.min.y) / 2;
            const upperNetZ = (upperNetMeshBbox.max.z - upperNetMeshBbox.min.z) / 2;

            const upperNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX - topCrossbarThickness, topCrossbarThickness, upperNetZ));
            const upperNetCenterOffset = new CANNON.Vec3(upperNetX + backNetXOffset, upperNetY * 2, 0);

            waterPoloGoalNetBody.addShape(upperNetShape, upperNetCenterOffset);


            // 4. SĀNA TĪKLI (starp aizmuguri un vārtu stabiem)
            const leftNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX - topCrossbarThickness, postsY, postsX));
            const rightNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX - topCrossbarThickness, postsY, postsX));
            
            const leftNetOffsetCenter = new CANNON.Vec3(upperNetX + backNetXOffset, postsY, -postsZ);
            const rightNetOffsetCenter = new CANNON.Vec3(upperNetX + backNetXOffset, postsY, postsZ);
            
            waterPoloGoalNetBody.addShape(leftNetShape, leftNetOffsetCenter);
            waterPoloGoalNetBody.addShape(rightNetShape, rightNetOffsetCenter);
            
            // Izveido noslēgtu kasti ap visiem vārtiem (trūkums: nevar "ieiet iekšā" vārtu rāmī)
            // const goalBox = threeToCannon(waterPoloGoalNet);
            // const {shape, offset, orientation} = goalBox;
            // // waterPoloGoalNetBody.addShape(shape, offset, orientation);
            // console.log(goalBox);

            // Pievieno salikto virsmu ainas fiziskajai pasaulei
            physicsWorld.addBody(waterPoloGoalNetBody);
        }

        // SADURSMES FIZIKAS (Collisions):
        waterPoloBallBody.addEventListener('collide', (event) => {
            if (event.body === waterPoloGoalNetBody) {
                console.log("ball collided with the net: ", event);
                console.log('Collision normal:', event.contact.ni.toString());

                waterPoloBall.userData.collidedWithGoal = true;

                const impactStrength = event.contact.getImpactVelocityAlongNormal();

                console.log("impactStrength: ", impactStrength);

                // TODO: Ieviest sadursmes pretējo kustību atkarībā no tās intensitātes 


                // if (impactStrength > 5) {
                //     animateGoalNetSway(impactStrength, event.contact.bi.position, event.contact.ni);
                // }
            }
        });

        const animateGoalNetSway = (impactStrength, position, normal) => {
            // TODO: Vārtu "šūpošanās" atkarībā no bumbas lidošanas ātruma
        }
    };

    const onWindowResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();

        renderer.setSize(window.innerWidth, window.innerHeight);
    };

    const initScene = async () => {
        loadingContainer.addEventListener('transitionend', (event) => {
            event.target.remove();
        });

        // Three.js ainas izveide
        scene = new THREE.Scene();
        
        // Iespējo WebGL renderētāju:
        renderer = new THREE.WebGLRenderer();
        renderer.setPixelRatio(window.devicePixelRatio);
        renderer.setSize(window.innerWidth, window.innerHeight);

        container.appendChild(renderer.domElement);
        container.style.touchAction = 'none';  // norāda pārlūkprogrammai, ka visi vilkšanas un pietuvināšanas event-i uz viedierīcēm ir jāignorē

        // Perspektīvas skata uzstādīšana un novietošana:
        camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
        camera.position.set(200, 100, 100);

        // Kameras kustības noteikšana:
        controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.target.set(0, 10, 0);
        controls.minDistance = 40.0;
        controls.maxDistance = 2000.0;
        controls.update();

        // Statistikas objekta uzstādīšana:
        stats = Stats();
        container.appendChild(stats.dom);

        // Apgaismojuma uzstādīšana:
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
        directionalLight.position.set(2, 2, 0);
        scene.add(directionalLight);

        // Modeļu ielādes objekti:
        const loadingManager = new THREE.LoadingManager();
        loadingManager.onStart = (url, itemsLoaded, itemsTotal) => {
            console.log(`Started loading file ${url} .\nLoaded ${itemsLoaded} of ${itemsTotal}`);
        };

        loadingManager.onLoad = () => {
            console.log('Loading complete');
            loadingContainer.classList.add('fade-out');
        };

        loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
            console.log(`Loading file ${url} .\nLoaded ${itemsLoaded} of ${itemsTotal}`);
        };

        loadingManager.onError = (url) => {
            console.log(`There was an error loading file ${url}`);
        };

        const gltfLoader = new THREE.GLTFLoader(loadingManager);
        const fbxLoader = new THREE.FBXLoader(loadingManager);
        
        // Ūdenspolo bumba:
        const waterPoloBallGLTFData = await modelLoader(gltfLoader, '/assets/models/water_polo_ball_FINAL_v2.glb')
            .catch((err) => {
                console.log("unable to load water polo ball model", err);
                return undefined;
            });

        if (waterPoloBallGLTFData) {
            waterPoloBall = waterPoloBallGLTFData.scene;
            waterPoloBall.scale.set(10, 10, 10);

            // Peldināšana pa dinamisko ūdens virsmu:
            waterPoloBall.userData.velocity = new THREE.Vector3();

            scene.add(waterPoloBall);
        }
        
        // Ūdenspolo vārti:
        const goalFBXData = await modelLoader(fbxLoader, '/assets/models/water_polo_goal_FINAL.fbx')
            .catch((err) => {
                console.log("unable to load goal model", err);
                return undefined;
            });

        if (goalFBXData) {
            waterPoloGoalNet = goalFBXData;
            waterPoloGoalNet.scale.set(1, 1, 1);
            scene.add(waterPoloGoalNet);

            waterPoloGoalNet.traverse((child) => {
                if (child.isMesh) {
                    if (child.name === 'Goal') {
                        goalNetMesh = child;
                    } else if (child.name === 'Cube002') {
                        crossbarWithPostsMesh = child;
                    } else if (child.name === 'Plane001') {
                        netFrameMesh = child;
                    }
                }
            });
        }

        // Baseins:
        const poolModelGLTFData = await modelLoader(gltfLoader, '/assets/models/water_polo_custom_pool_WITH_WATER_SURFACE.glb')
            .catch((err) => {
                console.log("unable to load pool model", err);
                return undefined;
            });

        if (poolModelGLTFData) {
            swimmingPool = poolModelGLTFData.scene;
            swimmingPool.scale.set(80, 80, 80);

            let poolWaterSurfaceChildObjects = [];

            // Noņemam ūdens virsmu, jo to beigās aizvietos ar pareizi novietoto `water` objektu
            swimmingPool.traverse((child) => {
                if (child.isMesh && child.name === 'WaterSurface') {
                    poolWaterSurfaceChildObjects.push(child);
                }
            });

            for (const obj of poolWaterSurfaceChildObjects) {
                obj.removeFromParent();
            }

            updateSun();

            scene.add(swimmingPool);
        }

        container.addEventListener('pointermove', (event) => {
            // Peles koordinātas jāuztver tikai no galvenā kursora 
            // Pakustinātais kursors nav galvenais, ja, piemēram, tas tiek reģistrēts kā otrs pieskāriens uz skārienjūtīgiem ekrāniem
            if (event.isPrimary === false) return;

            // Nosaka relatīvo pozīciju kā vektoru formātā (x, y), kur atrodas peles kursors attiecībā pret renderēto ainu: 
            //  *) x, y ir vērtības robežās [-1; 1], kur:
            //      *) -1 ir renderētās ainas pati kreisā mala, bet 1 - labā mala 
            //      *) -1 ir renderētās ainas pati augšējā mala, bet 1 - apakšējā mala
            // Darbojas arī tad, ja mainās ainas / ekrāna izmērs, jo rēķina relatīvo pozīciju
            // 0 nozīmē, ka atrodas pašā ainas centrā
            const NDC_x = 2 * (event.clientX / renderer.domElement.clientWidth) - 1;  // x = 2 * (x / <ekrāna_platums>) ∈ [0; 2] => x - 1 ∈ [-1; 1]
            const NDC_y = -2 * (event.clientY / renderer.domElement.clientHeight) + 1; // y = 2 * (y / <ekrāna_augstums>) ∈ [0; 2] => y - 1 ∈ [-1; 1]
            mouseCoords.set(NDC_x, NDC_y);
            mouseMoved = true;
        });

        const waterSetup = initWater(
            effectController,
            scene,
            renderer
        );

        ({
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
        } = waterSetup);

        isWaterRendered = true;

        if (waterPoloBall) {
            spheres.push(waterPoloBall);
        }

        // Fizikas pasaules un objektu definēšana:
        initPhysics();

        window.addEventListener('resize', onWindowResize);
    };

    // Katrā ainas animācijas kadrā atjaunina ainas elementu datus un pozīcijas:
    const animate = () => {
        requestAnimationFrame(animate);
        
        controls.update();

        // Fizikas pasaules simulācijas animēšana katrā kadrā:
        if (physicsWorld) {
            physicsWorld.fixedStep(); // Turpina izpildīt fiziskās pasaules simulācijas darbības
            cannonDebugger.update();  // Atjaunina fiziskās pasaules atkļūdotāja informāciju

            // Specgadījums: bumbas fiziskā objekta pozīcija ir atkarīga no bumbas atrašanās vietas uz ūdens virsmas
            // if (waterPoloBall.userData.collidedWithGoal) {
            //     waterPoloBallBody.position.copy(waterPoloBall.position);
            //     waterPoloBallBody.quaternion.copy(waterPoloBall.quaternion);
            //     waterPoloBall.userData.collidedWithGoal = false;
            // }

            // TODO: Izlabot problēmu, kur `sphereDynamics` apstājas tad, kad bumba saskarās ar vārtiem
            // Visu laiku vajag būt `sphereDynamics`, bet, kad bumba saskarās ar vārtiem, tad izslēdz `sphereDynamics`, to aizmet pretējā virzienā un tad atkal ieslēdz atpakaļ `sphereDynamics` 
            waterPoloBallBody.position.copy(waterPoloBall.position);
            waterPoloBallBody.quaternion.copy(waterPoloBall.quaternion);

            waterPoloGoalNet.position.copy(waterPoloGoalNetBody.position);
            waterPoloGoalNet.quaternion.copy(waterPoloGoalNetBody.quaternion);
        }
        
        render();

        stats.update();
    };

    const render = () => {
        if (isWaterRendered) {
            // Staru izstarošana ("raycasting") no peles kursora
            const uniforms = heightmapVariable.material.uniforms;
            if (mouseMoved) {
                raycaster.setFromCamera(mouseCoords, camera);
                const intersects = raycaster.intersectObject(meshRay);

                if (intersects.length > 0) {
                    // Peles kustība ir ūdens robežās, uzstāda pareizās koordinātas
                    const point = intersects[0].point;
                    uniforms['mousePos'].value.set(point.x, point.z);
                } else {
                    // Peles kursors atrodas ārpus ūdens robežām, atgriežamies pie noklusējuma vērtībām
                    uniforms['mousePos'].value.set(10000, 10000);
                }
                mouseMoved = false;
            } else {
                // Peles kursors nav kustināts, uzstāda konstantas noklusējuma vērtības (mierīga ūdens virsma)
                uniforms['mousePos'].value.set(10000, 10000);
            }

            gpuCompute.compute();

            if (!waterPoloBall.userData.collidedWithGoal) {
                if (spheresEnabled) {
                    sphereDynamics(
                        renderer,
                        gpuCompute,
                        heightmapVariable,
                        readWaterLevelShader,
                        readWaterLevelRenderTarget,
                        readWaterLevelImage,
                        waterNormal,
                        spheres
                    );
                }
            }

            // pirms kadra renderēšanas iegūst ūdens līmeņa augstuma ("heightmap") iegūto rezultātu GPU renderētājā, to atjauno "fragment shader" objektā
            waterUniforms['heightmap'].value = gpuCompute.getCurrentRenderTarget(heightmapVariable).texture;
        }

        renderer.render(scene, camera);
    };

    onMount(async () => {
        await initScene();
        animate();
    });
</script>

<div id="loader-container" bind:this={loadingContainer}>
    <div id="loader"></div>
</div>

<div id="scene" class="canvas-wrapper" bind:this={container}></div>

<style>
    .canvas-wrapper {
        position: relative;
    }
</style>