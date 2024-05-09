<script>
  import { onMount } from 'svelte';

  import AFrameView from './views/AFrameView.svelte';
  import ThreeJsView from './views/ThreeJSView.svelte';

  import { AFRAME, THREE } from './fix-dependencies/aframe.js';

  let browserName = '';
  
  let isInVR = false;

  onMount(() => {
    console.log("everything is mounted in main scene (AFRAME, THREE debug output): ", AFRAME, THREE);
    // isInVR = THREE.renderer.xr.isPresenting;
    isInVR = AFRAME.utils.device.checkHeadsetConnected();
    browserName = getBrowserName();

    console.log("is user in VR", isInVR);
    console.log("current browser", browserName);
  });

  const getBrowserName = () => {
    if (!isInVR) {
      // Adaptēts no: https://stackoverflow.com/a/9851769
      // Balstīts uz aktīvajiem pārlūkiem, kas atbalsta WebXR Device API un WebVR API (https://aframe.io/docs/1.5.0/introduction/vr-headsets-and-webxr-browsers.html#what-browsers-support-vr)
      // Chrome 1 - 79
      const isChrome = !!window.chrome && (!!window.chrome.webstore || !!window.chrome.runtime);

      // Opera 8.0+
      const isOpera = (!!window.opr && !!opr.addons) || !!window.opera || navigator.userAgent.indexOf(' OPR/') >= 0;

      // Firefox 1.0+
      const isFirefox = typeof InstallTrigger !== 'undefined';

      // Safari 3.0+ "[object HTMLElementConstructor]" 
      const isSafari = /constructor/i.test(window.HTMLElement) || (function (p) { return p.toString() === "[object SafariRemoteNotification]"; })(!window['safari'] || (typeof safari !== 'undefined' && window['safari'].pushNotification));

      // Internet Explorer 6-11
      const isIE = /*@cc_on!@*/false || !!document.documentMode;
      
      // Edge 20+
      const isEdge = !isIE && !!window.StyleMedia;

      if (isChrome) return 'Chrome';
      else if (isOpera) return 'Opera';
      else if (isFirefox) return 'Firefox';
      else if (isSafari) return 'Safari';
      else if (isEdge) return 'Edge';
      else return 'Unknown Browser';

    } else if (isInVR) {
      // TODO: Pievienot papildus VR ierīču nosaukumus
      if (AFRAME.utils.device.isOculusBrowser()) return 'Oculus Browser';
    }

    if (AFRAME.utils.device.isMobile()) {
      const userAgent = navigator.userAgent;
      if (AFRAME.utils.device.isIOS) return 'Safari iOS';
      else if (/IEMobile|Windows Phone|Lumia/i.test(userAgent)) return 'Windows Phone';
      else if (/Android/.test(userAgent)) return 'Android';
      else if (/BlackBerry|PlayBook|BB10/.test(userAgent)) return 'Blackberry';
      else if (/webOS|Mobile|Tablet|Opera Mini|\bCrMo\/|Opera Mobi/i.test(userAgent)) return 'Unknown mobile browser';
    }

    return 'Browser could not be identified';
  }
</script>

<div class="browser-info">
  <p>Browser: {browserName}</p>
</div>

{#if isInVR}
  <AFrameView />
{:else}
  <ThreeJsView />
{/if}