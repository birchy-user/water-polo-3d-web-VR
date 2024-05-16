<script>
  import { onMount } from "svelte";

  import { AFRAME } from "../fix-dependencies/aframe.js";

  // Visi kameras kustību veidi:
  import "aframe-extras";

  // Fizikas A-Frame vidē:
  import "@c-frame/aframe-physics-system";
  // import "aframe-physics-extras";

  // Vispārēja mijiedarbība ar ainu (desktop ar peli, mobile ar pieskārienu, VR ar roku kontrolieriem), izmantojot "Super Hands" komponenti
  import "super-hands";

  // "Drag-n-drop" komponente
  // Oriģinālais: https://github.com/jesstelford/aframe-click-drag-component
  // Atjaunotā versija, kas darbojas kopā ar A-Frame 1.5.0: https://github.com/kumitterer/aframe-click-drag-component
  
  // Izmantot tikai desktop pārlūkprogrammās
  // import registerClickDrag from '@kumitterer/aframe-click-drag-component';

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
              AFRAME.scenes[0].camera.el.object3D.position.z = 45;
          });
          this.el.sceneEl.addEventListener('exit-vr', () => {
              console.log('Exited VR');

              isUserInVRMode = false;
              AFRAME.scenes[0].camera.el.object3D.position.z = 25;
          });
        }
      });
    }

    // Peles un pieskārienu kustības notikumi ("events") tiek nodoti "super-hands" komponentei
    if (!AFRAME.components['mouse-physics-cursor']) {
      AFRAME.registerComponent('mouse-physics-cursor', {
        init: function () {
          this.eventRepeater = this.eventRepeater.bind(this);

          AFRAME.scenes[0].addEventListener('loaded', () => {
            AFRAME.scenes[0].canvas.addEventListener('mousedown', this.eventRepeater);
            AFRAME.scenes[0].canvas.addEventListener('mouseup', this.eventRepeater);
            AFRAME.scenes[0].canvas.addEventListener('touchstart', this.eventRepeater);
            AFRAME.scenes[0].canvas.addEventListener('touchmove', this.eventRepeater);
            AFRAME.scenes[0].canvas.addEventListener('touchend', this.eventRepeater);
          }, {
            once: true // visi event-i tiek izpildīti vienu reizi tad, kad aina tiek ielādēta
          })
        },
        eventRepeater: function (evt) {
          if (evt.type.startsWith('touch')) {
            evt.preventDefault();
            // kad ar pieskārienu velk pa viedierīces ekrānu, to ignorē, lai nebūtu konflikti ar "look-controls" (https://aframe.io/docs/1.5.0/components/look-controls.html)
            if (evt.type === 'touchmove') { 
              return; 
            }
          }

          this.el.emit(evt.type, evt.detail);
        }
      });
    }

    // Integrācija starp "aframe-physics-system" un "aframe-physics-extras" (avots: https://github.com/c-frame/aframe-super-hands-component/blob/master/getting-started.md)
    // Ieslēdz / izslēdz fizikas atkarībā no tā, vai VR kontroliera satveres ("grip") poga ir vai nav nospiesta
    if (!AFRAME.components['is-controller-collision-enabled']) {
      AFRAME.registerComponent('is-controller-collision-enabled', {
        init: function () {
          this.el.addEventListener('gripdown', function () {
            this.el.setAttribute('collision-filter', {collisionForces: true})
          })
          this.el.addEventListener('gripdown', function () {
            this.el.setAttribute('collision-filter', {collisionForces: false})
          })
        }
      });
    }

    console.log(THREE);

    console.log(waterPoloBall);

    console.log(swimmingPool);
  });
</script>
  
  <!-- Avots renderer atribūtam: https://aframe.io/docs/1.2.0/components/renderer.html#logarithmicdepthbuffer -->
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
        is-controller-collision-enabled
        static-body="shape: sphere; sphereRadius: 0.02"
        super-hands="colliderEvent: collisions;
                      colliderEventProperty: els;
                      colliderEndEvent: collisions;
                      colliderEndEventProperty: clearedEls;"
      ></a-mixin>
  
      <a-mixin id="baseSphere"
        grabbable draggable droppable
        body="shape: none; type: dynamic"
        shape="shape: sphere;"
      ></a-mixin>
    </a-assets>
  
    <!-- Definē brīvi kustināmu kameru: -->

    {#if isUserInVRMode}
      <!-- Lietotājs ir iegājis VR iegremdējošajā (immersive) vidē, tātad visas fizikas jāapstrādā ar roku modeļiem  -->
      <a-entity>
        <a-camera position="0 5 25"></a-camera>
  
        <a-entity 
          id="leftHandController"
          hand-controls="hand: left"
          mixin="physics-hands"
        >
        </a-entity>
        <a-entity 
          id="rightHandController"
          hand-controls="hand: right"
          mixin="physics-hands"
        >
        </a-entity>
      </a-entity>
    {:else}
      <!-- Kamēr lietotājs nav iegājis VR vidē, izmanto peles kursoru kā fizisku objektu sagrābšanas avotu -->
      <a-entity camera look-controls wasd-controls="fly: true" position="0 5 25"
          mouse-physics-cursor
          raycaster="objects: .grabbable"
          cursor="rayOrigin:mouse"
          body="type: static; shape: sphere; sphereRadius: 0.001"
          super-hands="colliderEvent: raycaster-intersection;
                       colliderEventProperty: els;
                       colliderEndEvent:raycaster-intersection-cleared;
                       colliderEndEventProperty: clearedEls;">
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
      position="0 2 -5"
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