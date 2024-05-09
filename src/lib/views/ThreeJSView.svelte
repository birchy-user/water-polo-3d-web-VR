<script>
    import { onMount } from 'svelte';

    import { THREE, CANNON } from '../fix-dependencies/aframe';
    import CannonDebugger from 'cannon-es-debugger';

    import { OrbitControls } from 'super-three/addons/controls/OrbitControls.js';
    import Stats from 'super-three/addons/libs/stats.module.js';

    // 3D objekti:
    import { Water } from 'super-three/examples/jsm/objects/Water.js';
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

    let container;

    let controls;

    // 3D modeļu objekti:
    let waterPoloBall;
    let waterPoloGoalNet;
    let swimmingPool;
    
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
    /** @see setMouseCoords - aprēķina formulas pamatojums */
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

    let sphereBody;
    let sphereMesh;

    let boxBody;
    let boxMesh;

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
        // water.material.uniforms['sunDirection'].value.copy(sun).normalize();

        sceneEnv.add(sky);
        renderTarget = pmremGenerator.fromScene(sceneEnv);
        scene.add(sky);

        scene.environment = renderTarget.texture;
    };

    // Definē ainas fizisko pasauli, izmantojot Cannon.js
    // Fiziskās pasaules objektus jāspēj sasaistīt kopā ar renderētajiem (vizuāli redzamajiem) objektiem
    const initPhysics = () => {
        physicsWorld = new CANNON.World({
            gravity: new CANNON.Vec3(0, -9.81, 0),
        });

        // Bezgalīga plakne
        const groundBody = new CANNON.Body({
            type: CANNON.Body.STATIC,
            shape: new CANNON.Plane()
        });

        groundBody.position.set(0, 20, 0);
        groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
        physicsWorld.addBody(groundBody);

        const radius = 5;

        sphereBody = new CANNON.Body({
            mass: 5,
            shape: new CANNON.Sphere(radius)
        });
        sphereBody.position.set(0, 50, 0);
        physicsWorld.addBody(sphereBody);

        const geometry = new THREE.SphereGeometry(radius);
        const material = new THREE.MeshNormalMaterial();
        sphereMesh = new THREE.Mesh(geometry, material);
        scene.add(sphereMesh);

        cannonDebugger = new CannonDebugger(scene, physicsWorld, {
            // color: 0xff0000
        });

        boxBody = new CANNON.Body({
            mass: 5,
            shape: new CANNON.Box(new CANNON.Vec3(1, 1, 1)),
        });
        boxBody.position.set(1, 35, 0);
        physicsWorld.addBody(boxBody);

        const boxGeometry = new THREE.BoxGeometry(2, 2, 2);
        const boxMaterial = new THREE.MeshNormalMaterial();
        boxMesh = new THREE.Mesh(boxGeometry, boxMaterial);
        scene.add(boxMesh);
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
        // renderer.toneMapping = THREE.ACESFilmicToneMapping;
        // renderer.toneMappingExposure = 1;

        container.appendChild(renderer.domElement);
        // norāda pārlūkprogrammai, ka visi vilkšanas un pietuvināšanas event-i uz viedierīcēm ir jāignorē
        container.style.touchAction = 'none';

        // Perspektīvas skata uzstādīšana un novietošana:
        camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
        camera.position.set(30, 30, 100);

        // camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 1, 3000 );
        // camera.position.set( 0, 200, 350 );
        // camera.lookAt( 0, 0, 0 );

        // Kameras kustības noteikšana:
        controls = new OrbitControls(camera, renderer.domElement);
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.target.set(0, 10, 0);
        controls.minDistance = 40.0;
        controls.maxDistance = 2000.0;
        controls.update();

        // Statistikas objekta uzstādīšana:
        // stats = new TestStats();
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
        // waterPoloBall = (await new THREE.GLTFLoader().loadAsync('/assets/models/water_polo_ball_FINAL_v2.glb')).scene;
        // waterPoloBall.scale.set(3, 3, 3);
        // scene.add(waterPoloBall);

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
            waterPoloGoalNet.scale.set(0.7, 0.7, 0.7);
            scene.add(waterPoloGoalNet);

            waterPoloGoalNet.position.x = -250; // Vārti vienmēr atradīsies noteiktā attālumā no futbola bumbas sākotnējās pozīcijas (0, 0, 0)
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
                    console.log("pool waterSurface loaded: ", child);
                    poolWaterSurfaceChildObjects.push(child);
                }
            })

            for (const obj of poolWaterSurfaceChildObjects) {
                obj.removeFromParent();
            }

            // Baseina virsma ir noņemta, tagad var ielādēt `water` modeli un to pozicionēt atbilstoši baseina modeļa izmēriem:
            // const waterGeometry = new THREE.PlaneGeometry(10000, 10000);
            // const testWaterGeometry = new THREE.PlaneGeometry(512, 512, 256, 256);
            // water = new Water(
            //     testWaterGeometry,
            //     {
            //         textureWidth: 512,
            //         textureHeight: 512,
            //         waterNormals: new THREE.TextureLoader()
            //             .load('/assets/textures/waternormals.jpg', (texture) => {
            //                 texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
            //             }),
            //         sunDirection: new THREE.Vector3(),
            //         sunColor: 0xffffff,
            //         waterColor: 0x001e0f,
            //         distortionScale: 3.7,
            //         fog: undefined
            //     }
            // );

            // water.material.wireframe = false;
            // water.rotation.x = - Math.PI / 2;

            updateSun();

            // scene.add(water);

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
            renderer,
            spheresEnabled
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

        if (waterPoloBall) {
            spheres.push(waterPoloBall);
        }

        isWaterRendered = true;

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
            physicsWorld.fixedStep();
            cannonDebugger.update();
            
            boxMesh.position.copy(boxBody.position);
            boxMesh.quaternion.copy(boxBody.quaternion);
            sphereMesh.position.copy(sphereBody.position);
            sphereMesh.quaternion.copy(sphereBody.quaternion);
        }
        
        render();

        stats.update();
    };

    const render = () => {
        // if (water) {
        //     water.material.uniforms['time'].value += 1.0 / 60.0;
        // }
        
        if (isWaterRendered) {
            // Ūdens virsmas renderēšana:
            // Staru izstarošana ("raycasting") no peles kursora
            const uniforms = heightmapVariable.material.uniforms;
            if (mouseMoved) {
                raycaster.setFromCamera(mouseCoords, camera);
                const intersects = raycaster.intersectObject(meshRay);

                if (intersects.length > 0) {
                    // Peles kustība ir ūdens robežās
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

            // Get compute output in custom uniform
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