<script>
  import { onMount } from "svelte";

  import { AFRAME } from "../fix-dependencies/aframe.js";

  // Fizikas A-Frame vidē (tikai izstrādes vidē, jo produkcijā šī bibliotēka negrib strādāt):
  if (process.env.NODE_ENV === 'development') {
    import("@c-frame/aframe-physics-system").then(() => {
      console.log("Physics system loaded");
    }).catch((err) => {
      console.error("Failed to load physics system", err);
    });
  }

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

    console.log(THREE);

    console.log(waterPoloBall);

    console.log(swimmingPool);
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
      <a-mixin id="physics-hands"
        sphere-collider="objects: .grabbable"
        super-hands
      ></a-mixin>

      <a-mixin id="baseSphere"
        grabbable stretchable draggable droppable
        dynamic-body
      ></a-mixin>
    </a-assets>
  
    <!-- Definē brīvi kustināmu kameru: -->
    {#if isUserInVRMode}
      <!-- Lietotājs ir iegājis VR iegremdējošajā (immersive) vidē, tātad visas fizikas jāapstrādā ar roku modeļiem  -->
      <a-entity>
        <a-camera></a-camera>
  
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
      id="goal"
      obj-model="obj: #water-polo-goal-obj; mtl: #water-polo-goal-mtl"
      position="0 0 -45"
      scale="15 15 15"
      rotation="0 -90 0"
      float-in-water="minAmplitude: -1; maxAmplitude: 0.5"
      body="type: static; shape: none"
      shape="shape: box; halfExtents: 0.75 0.75 0.75"
    ></a-entity>
  
    <a-entity
      bind:this={waterPoloBall}
      id="ball"
      gltf-model="url(/assets/models/soccer_ball.glb)" 
      position="0 1 -1"
      scale="1 1 1"
      mixin="baseSphere"
      class="grabbable"
    ></a-entity>
    
    <a-entity
      bind:this={swimmingPool}
      id="swimmingPool"
      gltf-model="url(/assets/models/water_polo_custom_pool_WITH_WATER_SURFACE.glb)" 
      position="0 0 0"
      rotation="0 90 0"
      scale="5 5 5"
      body="type: static; shape: none"
      shape="shape: box; halfExtents: 50 0.0005 50"
      replace-water-surface
    ></a-entity>
  
    <!-- Tā kā baseina modelis tiek ielādēts kā viens liels objekts, nepieciešams definēt tam atsevišķu sadursmes objektu -->
    <a-plane
      height="67"
      width="112.15"
      rotation="-90 0 90"
      position="0 -30 0"
      opacity="0.3"
      body="type: static; shape: none"
      shape="shape: box; halfExtents: 50 0.0005 50"
    ></a-plane>
  
    <a-sky-with-sun bind:this={sun} sun-position="1 1 1"></a-sky-with-sun>
  </a-scene>