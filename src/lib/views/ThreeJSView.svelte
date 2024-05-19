<script>
    import { onMount } from 'svelte';

    import { THREE, CANNON } from '../fix-dependencies/aframe';
    import { threeToCannon, ShapeType } from 'three-to-cannon';

    import { OrbitControls } from 'super-three/addons/controls/OrbitControls.js';
    import Stats from 'super-three/addons/libs/stats.module.js';

    // 3D objekti:
    import { Sky } from 'super-three/addons/objects/Sky.js';

    import { GPUComputationRenderer } from 'super-three/addons/misc/GPUComputationRenderer.js';
    import { SimplexNoise } from 'super-three/addons/math/SimplexNoise.js';

    import { initWater, moveFloatingObjects } from '../components/waterShaderWithImpactForce';
    import { 
        GOAL_CHILD_MESH_Cube002, 
        GOAL_CHILD_MESH_Goal, 
        GOAL_CHILD_MESH_Plane001, 
        POOL_WATER_SURFACE_NAME 
    } from '../helpers/consts';

    let scene; 
    let camera;
    let renderer;

    let water;
    let isWaterRendered = false;
    let waterPhysicalBody;

    let container;

    let controls;

    let allowDynamicMovement = true;

    // Gravitācija = 9.81 uz Zemes virsmas, bet pareizas simulācijas nolūkos nepieciešams to palielināt, lai bumbas kustība uz leju būtu reālistiskāka
    // const GRAVITY = 9.81;
    const GRAVITY = 40;

    // ŪDENSPOLO BUMBAS PARAMETRI (atbilstoši World Aquatics noteikumiem: https://resources.fina.org/fina/document/2024/03/19/e27c972a-b19d-4289-997e-427718461f82/Competition-Regulations-version-1st-January-2024-.pdf)
    const WATER_POLO_BALL_WEIGHT = 0.4; // Pieņem, ka bumbas masa ir 400g = 0.4 kg
    const WATER_POLO_BALL_RESTITUTION = 0.68;  // Vidējā ūdenspolo bumbas restitūcija no: https://arxiv.org/pdf/1708.01282
    
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
    let waterNormal = new CANNON.Vec3();

    let isDragging = false;

    // Peldošie objekti kā pāri: { "<obj_1_name>": <obj_1_physics_body>, "<obj_2_name>": <obj_2_physics_body>, ... }
    let floatingObjectsWithBodies = {};
    let floatingObjects = [];

    const simplex = new SimplexNoise();

    const effectController = {
        mouseSize: 20.0,
        viscosity: 0.98
    };

    // Fizikas pasaule:
    let physicsWorld;

    // 3D modeļu objekti, fiziskie ķermeņi:
    let waterPoloBall;
    let waterPoloBallBody;      // Bumbas fiziskais modelis
    const ballRadius = 5;

    let waterPoloGoalNet;
    let goalNetMesh;            // Vārtu rāmis ar tīklu
    let crossbarWithPostsMesh;  // Vārtu augšējais stabs un sānu stabi
    let netFrameMesh;           // Balsti, kas savieno tīklu ar stabiem
    
    let waterPoloGoalNetBody;   // Vārtu fiziskais modelis
    
    let swimmingPool;
    let swimmingPoolBody;

    // Objektu sagrābšana:
    let jointBody;
    let jointConstraint;
    let movementPlane;
    
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
        // Fiziskās pasaules īpašības (Zemes gravitācija -9.81 m/s^2)
        physicsWorld = new CANNON.World({
            gravity: new CANNON.Vec3(0, -GRAVITY, 0),
        });

        // objektu sadursmes materiāli:
        const ballMaterial = new CANNON.Material();
        const goalNetMaterial = new CANNON.Material();

        const ballGoalContactMaterial = new CANNON.ContactMaterial(ballMaterial, goalNetMaterial, {
            // restitution: 0, // Jo augstāka restitūcija, jo spēcīgāk atsitas pret citu virsmu, ar kuru saduras
            restitution: WATER_POLO_BALL_RESTITUTION
        });

        const waterMaterial = new CANNON.Material();

        physicsWorld.addContactMaterial(ballGoalContactMaterial);

        if (isWaterRendered) {
            // Ūdens virsmas fiziskais modelis ir nekustīga statiska plakne, kas nelaiž cauri objektus (citādi tas negatīvi ietekmē to animāciju pa ūdens virsmu)
            waterPhysicalBody = new CANNON.Body({
                type: CANNON.Body.STATIC,
                shape: new CANNON.Plane(),
                material: waterMaterial
            });

            // Avots: https://schteppe.github.io/cannon.js/docs/classes/Quaternion.html
            // "Quaternion" (Q) apraksta rotāciju 3D telpā, kas matetmātiski ir aprakstīta ar formulu: Q = x*i + y*j + z*k + w, kur
            //      *) i, j, k ir komplekso skaitļu bāzes vektori
            //      *) (x, y, z) - reālo skaitļu bāzes vektors, kas saistīts ar rotācijas asīm 
            //      *) w - rotācijas skala (cik daudz rotācijas tiek izpildītas), 0 nozīmē, ka tiek izpildīta viena rotācija
            waterPhysicalBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
            waterPhysicalBody.position.set(0, 0, 0);

            physicsWorld.addBody(waterPhysicalBody);

            // Satvērēja objekts, ko izmanto, lai vilktu objektus pa ainu, izmantojot peles kursoru
            const jointShape = new CANNON.Sphere(0.1);
            jointBody = new CANNON.Body({ mass: 0 });
            jointBody.addShape(jointShape);
            jointBody.collisionFilterGroup = 0;
            jointBody.collisionFilterMask = 0;
            physicsWorld.addBody(jointBody);
        }

        if (waterPoloBall) {
            // Ūdenspolo bumbas fiziskais modelis
            waterPoloBallBody = new CANNON.Body({
                mass: WATER_POLO_BALL_WEIGHT,
                position: new CANNON.Vec3(0, ballRadius + 0.5, 0),
                material: ballMaterial
            });
            waterPoloBallBody.addShape(new CANNON.Sphere(ballRadius));

            // const {shape, offset, orientation} = threeToCannon(waterPoloBall, {
            //     type: ShapeType.SPHERE
            // });
            // waterPoloBallBody.addShape(shape, offset, orientation);

            // console.log("water polo body shape, offset, orientation: ", shape, offset, orientation);

            // Lai noteiktu pareizu kustību, vajag sekot līdzi, kad bumba saskārās ar vārtu objektu (saikne ar `moveFloatingObjects`)
            waterPoloBall.userData.collidedWithGoal = false;

            // waterPoloBallBody.angularDamping = 0.9;
            waterPoloBallBody.linearDamping = 0.3;  // Gaisa pretestība
            waterPoloBallBody.velocity = new CANNON.Vec3(); // Peldināšana pa dinamisko ūdens virsmu

            floatingObjectsWithBodies[waterPoloBall.name] = waterPoloBallBody;

            physicsWorld.addBody(waterPoloBallBody);

            // SADURSME AR ŪDENI
            const waterMaterial = new CANNON.Material();

            physicsWorld.addContactMaterial(new CANNON.ContactMaterial(ballMaterial, waterMaterial, {
                restitution: WATER_POLO_BALL_RESTITUTION
            }));
        }

        if (waterPoloGoalNet) {
            // Vārtu modeļa sastāvdaļu izmēri (dimensijas) jeb "bounding box"
            const backNetMeshBbox = new THREE.Box3().setFromObject(goalNetMesh);
            const postsBbox = new THREE.Box3().setFromObject(crossbarWithPostsMesh);
            const upperNetMeshBbox = new THREE.Box3().setFromObject(netFrameMesh);

            // Konstruē fizisko modeli vārtiem un tā sastāvdaļām:
            waterPoloGoalNetBody = new CANNON.Body({ 
                mass: 0,
                position: new CANNON.Vec3(-350, 1, 0),
                material: goalNetMaterial
            });
            
            // 1. VĀRTU AIZMUGURĒJAIS RĀMIS

            const backNetX = 1;
            const backNetXOffset = -10;
            const backNetY = (backNetMeshBbox.max.y - backNetMeshBbox.min.y) / 2;
            const backNetZ = (backNetMeshBbox.max.z - backNetMeshBbox.min.z) / 2;

            const backNetShape = new CANNON.Box(new CANNON.Vec3(backNetX, backNetY - 1, backNetZ));
            const backNetPosition = new CANNON.Vec3(backNetXOffset, backNetY, 0);

            waterPoloGoalNetBody.addShape(backNetShape, backNetPosition, new CANNON.Quaternion().setFromEuler(0, 0, -Math.PI / 15));

            
            // 2. VĀRTU STABI (kreisais un labais vārtu stabs + augšējais vārtu stabs)

            const postsX = (postsBbox.max.x - postsBbox.min.x) / 2;  // Dala ar 2, jo jāiegūst vidus punkts katrā objekta iekšējās pasaules asī
            const postsY = (postsBbox.max.y - postsBbox.min.y) / 2;
            const postsZ = (postsBbox.max.z - postsBbox.min.z) / 2;
            const postZOffset = postsZ / 3.15;

            const leftPostShape = new CANNON.Box(new CANNON.Vec3(postsX, postsY, postsX + 1));
            const rightPostShape = new CANNON.Box(new CANNON.Vec3(postsX, postsY, postsX + 1));
            
            const leftPostCenterOffset = new CANNON.Vec3(postsZ - postZOffset, postsY, postsZ - 3); // -z līdz galam
            const rightPostCenterOffset = new CANNON.Vec3(postsZ - postZOffset, postsY, -postsZ + 3); // +z līdz galam
            
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

            const upperNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX, 1, upperNetZ));
            const upperNetCenterOffset = new CANNON.Vec3(upperNetX - topCrossbarThickness * 1.5, upperNetY * 2 - 2, 0);

            waterPoloGoalNetBody.addShape(upperNetShape, upperNetCenterOffset);

            // 4. SĀNA TĪKLI (starp aizmuguri un vārtu stabiem)

            const leftNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX, postsY - 2, postsX));
            const rightNetShape = new CANNON.Box(new CANNON.Vec3(upperNetX, postsY - 2, postsX));
            
            const leftNetOffsetCenter = new CANNON.Vec3(upperNetX + backNetXOffset, postsY, postsZ);
            const rightNetOffsetCenter = new CANNON.Vec3(upperNetX + backNetXOffset, postsY, -postsZ);
            
            waterPoloGoalNetBody.addShape(leftNetShape, leftNetOffsetCenter);
            waterPoloGoalNetBody.addShape(rightNetShape, rightNetOffsetCenter);
            
            // Izveido noslēgtu kasti ap visiem vārtiem (trūkums: nevar "ieiet iekšā" vārtu rāmī)
            // const goalBox = threeToCannon(waterPoloGoalNet);
            // const {shape, offset, orientation} = goalBox;
            // waterPoloGoalNetBody.addShape(shape, offset, orientation);

            // Pievieno salikto virsmu ainas fiziskajai pasaulei
            physicsWorld.addBody(waterPoloGoalNetBody);
        }

        // SADURSMES FIZIKAS ("Collisions"):
        waterPoloBallBody.addEventListener('collide', (event) => {
            if (event.body === waterPoloGoalNetBody) {
                console.log("ball collided with the net: ", event);

                waterPoloBall.userData.collidedWithGoal = true;

                const impactVelocity = event.contact.getImpactVelocityAlongNormal();

                // TODO: Paeksperimentēt ar paātrinājuma izmaiņām pēc sadursmes ar vārtiem (jo stiprāka sadursme, jo tālāk atpakaļ aizlido)
                waterPoloBallBody.velocity.x += event.contact.ni.x * impactVelocity * 0.5;
                waterPoloBallBody.velocity.z += event.contact.ni.z * impactVelocity * 0.5;

            } else if (event.body === waterPhysicalBody) {
                console.log("ball collided with water", event);

                let velocity = waterPoloBallBody.velocity;

                // Pieņem, ka ūdens virsma ir stingra virsma, kas atbilst spogulim - šādā vienkāršā modelī var izmantot Snella likumu jeb gaismas laušanas likumu, 
                // lai aptuveni noteiktu, kāds ir izejas leņķis, kādā bumba atleks no ūdens virsmas pēc sadursmes ar to
                let v_in = velocity.length();
                let theta = Math.atan2(velocity.y, velocity.x); // krišanas leņķis

                // sākotnējā ātruma vektora perpendikula komponente (y) pēc sīnusa likuma taisnleņķa trijstūrī
                let v_perpendicular_in = v_in * Math.sin(theta);

                // Aprēķina jauno ātrumu pēc restitūcijas koeficienta (sadursmes elastība): <ātrums pēc sadursmes> = <ātrums pirms sadursmes> * <restitūcijas koeficients> (avots: https://en.wikipedia.org/wiki/Coefficient_of_restitution)
                // Pareizina ar -1, jo ir jāiegūst ūdens virsmas izejas vektora perpendikulārā komponente
                // Ūdens paņem kaut kādu enerģiju, tāpēc izejas perpendikulārā komponente jāpareizina ar restitūcijas koeficientu
                let v_perpendicular_out = -1 * WATER_POLO_BALL_RESTITUTION * v_perpendicular_in;
                
                // Pieņem, ka paralēlā komponente paliek konstanta (ignorē ūdens virsmas pretestību) - to aprēķina no sākotnējā ātruma vektora ar kosinusa likumu
                let v_parallel_out = v_in * Math.cos(theta);

                // Pitagora teorēma: <izejas_vektors> = sqrt(<izejas_perpendikulārā_komponente>^2 + <izejas_paralēlā_komponente>^2)
                let v_out = Math.sqrt(v_perpendicular_out ** 2 + v_parallel_out ** 2);

                let theta_out = Math.atan2(v_perpendicular_out, v_parallel_out);  // Izejas leņķis

                // Rezultējošo vektoru un leņķi piereizina klāt pie izejas ātruma vektora
                waterPoloBallBody.velocity.x = v_out * Math.cos(theta_out);
                waterPoloBallBody.velocity.y = v_out * Math.sin(theta_out);

                waterPoloBall.userData.hasCollidedWithWater = true;
            }
        });
    };

    /**
     * Izmanto staru izstarošanu ("raytracing"), lai no peles koordinātām ainā uzzinātu, vai ir atrasts `mesh` modelis
     * 
     * @param mesh - modelis, kuru meklē
     * @param camera - 3D ainas kameras objekts 
     */
    const isMeshFound = (mesh, camera) => {
        // Izstaro staru no peles kursora koordinātām ainā
        raycaster.setFromCamera(mouseCoords, camera);

        // Atgriež tuvāko objektu, kuram trāpija stars (skatās tikai padotos modeļu objektus), ja tāds ir
        const intersects = raycaster.intersectObject(mesh);
        return intersects.length > 0 ? intersects[0].point : undefined;
    };

    const moveMovementPlane = (point, camera) => {
        // Centrē kustības plakni uz peles kursoru
        movementPlane.position.copy(point);

        // Pagriež kustības plakni kameras virzienā
        movementPlane.quaternion.copy(camera.quaternion);
    };

    /**
     * `position` koordinātās pievieno vilkšanas reģistrēšanas objektu kā saikni ar norādīto `constrainedBody` fizisko ķermeņi, 
     * ar kuru varēs vilkt objektu pa ainu
     * 
     * @param position - pozīcija, kurā pievieno `constrainedBody`
     * @param constrainedBody - fiziskais ķermeņis, kuru vilks pa ainu
     */
    const addJointConstraint = (position, constrainedBody) => {
        if (jointConstraint) {
            physicsWorld.removeConstraint(jointConstraint);
        }
        
        jointBody.position.copy(position);
        const pivot = new CANNON.Vec3();  // Centrē atskaites punktu relatīvi ķermeņa centram

        // Izveido jaunu saikni starp vilkšanas reģistrēšanas objektu un fizisko ķermeni (ja viens kustas, tad otrs seko līdzi)
        jointConstraint = new CANNON.PointToPointConstraint(constrainedBody, pivot, jointBody, new CANNON.Vec3(0, 0, 0));
        physicsWorld.addConstraint(jointConstraint);
    };

    /**
     * Noņem saikni starp fizisko ķermeni un vilkšanas reģistrēšanas objektu
     */
    const removeJointConstraint = () => {
        physicsWorld.removeConstraint(jointConstraint);
        jointConstraint = undefined;
    };

    /**
     * Kustina vilkšanas reģistrēšanas objektu uz jaunu `position` ainā un atjaunina saikni starp to un fizisko ķermeni
     * 
     * @param position - punkts, uz kuru tiek novirzīts vilkšanas reģistrēšanas objekts
     */
    const moveJoint = (position) => {
        jointBody.position.copy(position);
        jointConstraint.update();
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

        // Kustīga plakne, kas reģistrē vilkšanas kustības:
        const planeGeometry = new THREE.PlaneGeometry(10000, 10000);
        const planeMaterial = new THREE.MeshLambertMaterial({ color: 0x777777 })
        movementPlane = new THREE.Mesh(
            planeGeometry,
            planeMaterial
        );
        movementPlane.visible = false;
        scene.add(movementPlane);

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
        const waterPoloBallGLTFData = await modelLoader(gltfLoader, '/assets/models/soccer_ball.glb')
            .catch((err) => {
                console.log("unable to load water polo ball model", err);
                return undefined;
            });

        if (waterPoloBallGLTFData) {
            waterPoloBall = waterPoloBallGLTFData.scene.children[0];
            waterPoloBall.scale.set(15, 15, 15);

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
                    if (child.name === GOAL_CHILD_MESH_Goal) {
                        goalNetMesh = child;
                    } else if (child.name === GOAL_CHILD_MESH_Cube002) {
                        crossbarWithPostsMesh = child;
                    } else if (child.name === GOAL_CHILD_MESH_Plane001) {
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
            swimmingPool.scale.set(50, 80, 80);
            // swimmingPool.scale.set(47, 80, 77);

            // swimmingPool.scale.set(80, 80, 80);

            let poolWaterSurfaceChildObjects = [];

            // Noņemam ūdens virsmu, jo to beigās aizvietos ar pareizi novietoto `water` objektu
            swimmingPool.traverse((child) => {
                if (child.isMesh && child.name === POOL_WATER_SURFACE_NAME) {
                    poolWaterSurfaceChildObjects.push(child);
                }
            });

            for (const obj of poolWaterSurfaceChildObjects) {
                obj.removeFromParent();
            }

            updateSun();

            scene.add(swimmingPool);
        }

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
            water,
            meshRay
        } = waterSetup);

        isWaterRendered = true;

        // Pievieno kā uz ūdens virsmas peldošu objektu
        if (waterPoloBall) {
            floatingObjects.push(waterPoloBall);
        }

        // Fizikas pasaules un objektu definēšana:
        initPhysics();

        // Peles kustības uzķeršanas funkcijas:
        container.addEventListener('pointerdown', (event) => {
            const NDC_x = 2 * (event.clientX / renderer.domElement.clientWidth) - 1
            const NDC_y = - (2 * (event.clientY / renderer.domElement.clientHeight) - 1);
            mouseCoords.set(NDC_x, NDC_y);

            // Izstaro staru tur, kur rāda peles kursors - reģistrē notikumu, ja stars trāpa ūdenspolo bumbas modelim
            const hitPoint = isMeshFound(waterPoloBall, camera);
            if (!hitPoint) {
                return;
            }

            // Kustības plakne tiek kustināta pa z-asi
            moveMovementPlane(hitPoint, camera);

            // Izveido saikni starp bumbas fizisko ķermeni un vilkšanas reģistrēšanas objektu
            addJointConstraint(hitPoint, waterPoloBallBody);

            allowDynamicMovement = false;

            // Peles kustību reģistrē nākošajā kadrā, lai nodrošinātu, ka fiziskais objekts ir pakustējies peles kursora virzienā
            requestAnimationFrame(() => {
                waterPoloBall.userData.isDragging = true;
                isDragging = true;
            });
        });

        container.addEventListener('pointermove', (event) => {
            // 1. peles koordinātas jāuztver tikai no galvenā kursora (pakustinātais kursors nav galvenais, ja, piemēram, tas tiek reģistrēts kā otrs pieskāriens uz skārienjūtīgiem ekrāniem)
            if (event.isPrimary === false) return;

            // Nosaka relatīvo pozīciju kā vektoru formātā (x, y), kur atrodas peles kursors attiecībā pret renderēto ainu: 
            //  *) x, y ir vērtības robežās [-1; 1], kur:
            //      *) -1 ir renderētās ainas pati kreisā mala, bet 1 - labā mala 
            //      *) -1 ir renderētās ainas pati augšējā mala, bet 1 - apakšējā mala
            // Darbojas arī tad, ja mainās ainas / ekrāna izmērs, jo rēķina relatīvo pozīciju
            // 0 nozīmē, ka atrodas pašā ainas centrā
            // Oriģināli NDC (0, 0) punkts atrodas reģiona apakšējā - kreisajā stūrī, bet tīmeklī šis punkts atrodas augšējā - kreisajā stūrī, tāpēc y koordināta jāpagriež pretējā virzienā (jāreizina ar -1)
            const NDC_x = 2 * (event.clientX / renderer.domElement.clientWidth) - 1;  // x = 2 * (x / <ekrāna_platums>) ∈ [0; 2] => x - 1 ∈ [-1; 1]
            const NDC_y = - (2 * (event.clientY / renderer.domElement.clientHeight) - 1); // y = 2 * (y / <ekrāna_augstums>) ∈ [0; 2] => y - 1 ∈ [-1; 1]
            mouseCoords.set(NDC_x, NDC_y);
            mouseMoved = true;

            // 2. objektu vilkšana pa ekrānu:
            if (!isDragging) return;

            // Projicē peles koordinātas uz kustīgās plaknes, iegūst saskarsmes punktu ar ūdenspolo bumbas fizisko ķermeni
            // Ja tāds ir atrasts, pakustina saiknes objektu uz to
            const hitPoint = isMeshFound(movementPlane, camera);

            if (hitPoint) {
                moveJoint(hitPoint);
            }
        });

        container.addEventListener('pointerup', () => {
            // Peles kursors ir atlaists, atlaiž vaļā satverto objektu
            removeJointConstraint();
            waterPoloBall.userData.isDragging = false;
            isDragging = false;
            
            // allowDynamicMovement = true;
        });

        window.addEventListener('resize', onWindowResize);
    };

    // Katrā ainas animācijas kadrā atjaunina ainas elementu datus un pozīcijas:
    const animate = () => {
        requestAnimationFrame(animate);

        // Izslēdz kameras rotāciju, ja ar peles kursoru tiek vilkts kāds objekts
        if (isDragging) {
            controls.enableRotate = false;
        } else {
            controls.enableRotate = true;
        }
        
        controls.update();

        // Fizikas pasaules simulācijas animēšana katrā kadrā:
        if (physicsWorld) {
            physicsWorld.step(1 / 60);   // Izpilda vienu fiksētu soli fiziskajā pasaulē (izpilda fiziskās pasaules simulācijas darbības)
        }
        
        render();

        stats.update();
    };

    const render = () => {
        if (isWaterRendered && physicsWorld) {
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

            // Ja bumbas fiziskais modelis ir atsities pret vārtu objektu, pagaida, līdz kamēr tā paātrinājums ir stipri samazinājies, un tad to atkal nogādā pie `moveFloatingObjects`
            if (waterPoloBall.userData.collidedWithGoal) {
                waterPoloBall.userData.collidedWithGoal = false;
            }

            if (!waterPoloBall.userData.collidedWithGoal && allowDynamicMovement) {
                moveFloatingObjects(
                    renderer,
                    gpuCompute,
                    heightmapVariable,
                    readWaterLevelShader,
                    readWaterLevelRenderTarget,
                    readWaterLevelImage,
                    waterNormal,
                    floatingObjects,
                    floatingObjectsWithBodies
                );
            }

            // Katrā kadrā sinhronizē vizuālā modeļa un tā atbilstošā fiziskā ķermena pozīciju un rotāciju 3D ainā
            waterPoloBall.position.copy(waterPoloBallBody.position);
            waterPoloBall.quaternion.copy(waterPoloBallBody.quaternion);

            waterPoloGoalNet.position.copy(waterPoloGoalNetBody.position);
            waterPoloGoalNet.quaternion.copy(waterPoloGoalNetBody.quaternion);

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