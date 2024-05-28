<script>
  import { onMount } from "svelte";

  import { AFRAME, THREE } from "../fix-dependencies/aframe.js";

  import "aframe-physics-system/dist/aframe-physics-system.js";

  // Visi kameras kustību veidi:
  import "aframe-extras";

  // Vispārēja mijiedarbība ar ainu (desktop ar peli, mobile ar pieskārienu, VR ar roku kontrolieriem), izmantojot "Super Hands" komponenti
  import "super-hands";

  // Saules un debesu objekts:
  import "../components/aframe/sun.js";

  // Peldoša objekta komponente:
  import "../animations/floating.js";

  // Ūdens virsmas komponente:
  import "../components/aframe/water.js";

  import { 
      GOAL_CHILD_MESH_Cube002, 
      GOAL_CHILD_MESH_Goal, 
      GOAL_CHILD_MESH_Plane001, 
      POOL_WATER_SURFACE_NAME 
  } from '../helpers/consts';

  let aframeScene;

  let sun;

  let waterPoloBall;
  let goalModel;
  let swimmingPool;

  let isUserInVRMode = false;

  onMount(() => {
    // Global state, lai pārbaudītu, vai tiešām lietotājs ir iegājis VR režīmā
    if (!AFRAME.components['adjust-for-vr']) {
      AFRAME.registerComponent('adjust-for-vr', {
        init: function() {
          this.el.sceneEl.addEventListener('enter-vr', () => {
              console.log('Entered VR');

              isUserInVRMode = true;
              // AFRAME.scenes[0].camera.el.object3D.position.z = 45;
              // AFRAME.scenes[0].camera.el.object3D.position.y = 2;
          });
          this.el.sceneEl.addEventListener('exit-vr', () => {
              console.log('Exited VR');

              isUserInVRMode = false;
              // AFRAME.scenes[0].camera.el.object3D.position.z = 25;
              // AFRAME.scenes[0].camera.el.object3D.position.y = 2;
          });
        }
      });
    }

    // Novieto bumbas objektu nedaudz uz priekšu (5 vienību attālumā uz priekšu) no lietotāja VR režīmā tad,
    // kad tiek nospiesta Meta Quest 2 VR kontrolieru B poga
    if (!AFRAME.components['recall-ball-to-hand']) {
      AFRAME.registerComponent('recall-ball-to-hand', {
        schema: {
          ball: { type: 'selector' },
        },

        init: function() {
          this.el.addEventListener('bbuttondown', this.recallBallOnBPress.bind(this));
        },

        recallBallOnBPress: function (evt) {
          const ballEl = this.data.ball;
          const cameraEl = this.el.sceneEl.camera.el;

          if (ballEl && cameraEl) {
            if (!ballEl.components['grabbable']) return;
            if (ballEl.is('grabbed') || ballEl.grabbed) return;

            const cameraObj = cameraEl.object3D;
            const ballBody = ballEl.body;

            const direction = new THREE.Vector3();
            cameraObj.getWorldDirection(direction);
            direction.multiplyScalar(-5);

            const newPosition = cameraObj.position.clone().add(direction);
            ballEl.setAttribute('position', newPosition);
            ballBody.position.x = newPosition.x;
            ballBody.position.y = newPosition.y;
            ballBody.position.z = newPosition.z;

            if (ballBody) {
              ballBody.velocity.set(0, 0, 0);
              ballBody.angularVelocity.set(0, 0, 0);
            }
          }
        }
      });
    }

    
    aframeScene.addEventListener('loaded', () => {
      console.log("aframeScene loaded: ", aframeScene);

      if (aframeScene.systems.physics) {
        const world = aframeScene.systems.physics.driver.world;
        console.log("CANNON World: ", world);

        goalModel.addEventListener('body-loaded', (e) => {
          const goalBody = e.detail.body;
          console.log("Goal body loaded: ", goalBody);

          const [ upperNetOrientation, backNetOrientation, leftNetOrientation, rightNetOrientation ] = goalBody.shapeOrientations;

          backNetOrientation.setFromEuler(0, 0, Math.PI / 2);

          leftNetOrientation.setFromEuler(0, Math.PI / 2, 0);
          rightNetOrientation.setFromEuler(0, Math.PI / 2, 0);
        });

        swimmingPool.addEventListener('model-loaded', () => {
          console.log("Swimming pool model loaded");
        });
      }
    });
  });
</script>
  
<a-scene 
  bind:this={aframeScene}
  physics
  adjust-for-vr
>
  <!-- Ūdenspolo vārtu modeļa (OBJ) ielāde -->
  <a-assets>
    <a-asset-item id="water-polo-goal-obj" src="/assets/models/water_polo_goal_FINAL.obj"></a-asset-item>
    <a-asset-item id="water-polo-goal-mtl" src="/assets/models/water_polo_goal_FINAL.mtl"></a-asset-item>

    <!-- "Mixin" objekti vairākkārtējai izmantošanai (adaptēts no: https://github.com/c-frame/aframe-super-hands-component/blob/master/getting-started.md) -->
    <a-mixin
      id="physics-hands"
      static-body="shape: sphere; sphereRadius: 0.02;"
      sphere-collider="objects: .grabbable"
      super-hands
    ></a-mixin>

    <a-mixin 
      id="baseSphere"
      grabbable stretchable draggable droppable
      body="type: dynamic; mass: 5; shape: none"
      shape="shape: sphere; radius: 0.55"
    ></a-mixin>
  </a-assets>

  <!-- Definē brīvi kustināmu kameru: -->
  {#if isUserInVRMode}
    <!-- Lietotājs ir iegājis VR iegremdējošajā (immersive) vidē, tātad visas fizikas jāapstrādā ar roku modeļiem  -->
    <a-entity id="rig">
      <a-camera position="0 1.6 25"></a-camera>

      <a-entity 
        id="leftHandController"
        mixin="physics-hands"
        hand-controls="hand: left"
      >
      </a-entity>
      <a-entity 
        id="rightHandController"
        mixin="physics-hands"
        hand-controls="hand: right"
        recall-ball-to-hand="ball: #ball"
      >
      </a-entity>
    </a-entity>
  {:else}
    <!-- Kamēr lietotājs nav iegājis VR vidē, izmanto peles kursoru kā kustību avotu -->
    <a-entity id="rig" movement-controls position="0 1.6 25">
      <a-entity
        camera
        look-controls
        orbit-controls="minDistance: 0.5; maxDistance: 180; initialPosition: 0 10 30; screenSpacePanning: true;"
      >
      </a-entity>
    </a-entity>
  {/if}

  <!-- Apgaismo visu ainu: -->
  <a-entity light="type: ambient; color: #AAA"></a-entity>
  <a-entity light="type: directional; color: #DDD; intensity: 0.6" position="0.7 0.4 -1"></a-entity>

  <a-entity
    bind:this={waterPoloBall}
    id="ball"
    gltf-model="url(/assets/models/soccer_ball.glb)" 
    position="0 10 -1"
    scale="1 1 1"
    class="grabbable"
    mixin="baseSphere"
  ></a-entity>

  <a-entity 
    bind:this={goalModel}
    id="goal"
    obj-model="obj: #water-polo-goal-obj; mtl: #water-polo-goal-mtl"
    position="0 0 -45"
    scale="15 15 15"
    rotation="0 -90 0"
    float-in-water="minAmplitude: -1; maxAmplitude: 0.5"
    body="type: static; shape: none"
    shape__uppernet="shape: box; halfExtents: 0.58 0.0005 1.5; offset: 0.5 0.9 0;"
    shape__backnet="shape: box; halfExtents: 0.45 0.0005 1.5; offset: -0.1 0.45 0;"
    shape__leftnet="shape: box; halfExtents: 0.05 0.45 0.555; offset: 0.5 0.45 1.5"
    shape__rightnet="shape: box; halfExtents: 0.05 0.45 0.555; offset: 0.5 0.45 -1.5;"
  ></a-entity>
  
  <a-entity
    bind:this={swimmingPool}
    id="swimmingPool"
    gltf-model="url(/assets/models/water_polo_custom_pool_WITH_WATER_SURFACE.glb)" 
    position="0 0 0"
    rotation="0 90 0"
    scale="5 5 5"
    body="type: static; shape: none"
    shape="shape: box; halfExtents: 12.5 0.0005 8"
    replace-water-surface
  ></a-entity>

  <a-sky-with-sun bind:this={sun} sun-position="1 1 1"></a-sky-with-sun>
</a-scene>