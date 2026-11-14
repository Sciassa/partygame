import * as THREE from 'three';

/**
 * Materiale "vinyl toy opaco": MeshStandardMaterial con metalness 0 e roughness alta,
 * più una luce di taglio ("rim light") calcolata nello shader.
 *
 * Perché anche nello shader e non solo con luci vere? Una luce di controluce reale illumina solo
 * le superfici rivolte verso di lei: su oggetti piccoli e tondeggianti (bicchieri, pioli) il bordo
 * acceso si vede a tratti. Il termine di Fresnel invece disegna sempre una lama di luce calda
 * sulla sagoma, dal lato della luce ambra (in alto a sinistra), come nella fotografia di prodotto.
 *
 *   rim = (1 - N·V)^power × lato(N·direzioneLuce) × intensità × coloreAmbra
 */
export const RIM_LIGHT = {
  color: { value: new THREE.Color('#ff9f45') },
  // direzione (spazio vista) da cui arriva la luce di taglio: alto-sinistra, leggermente da dietro
  direction: { value: new THREE.Vector3(-0.62, 0.74, -0.25).normalize() },
};

/**
 * @param {object} opts parametri di MeshStandardMaterial + rimStrength/rimPower
 */
export function vinylMaterial({ rimStrength = 0.85, rimPower = 2.4, ...params } = {}) {
  const material = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, ...params });
  material.metalness = 0; // regola dello stile: niente metallo, l'oro è un colore
  material.userData.rim = { strength: { value: rimStrength }, power: { value: rimPower } };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRimColor = RIM_LIGHT.color;
    shader.uniforms.uRimDir = RIM_LIGHT.direction;
    shader.uniforms.uRimStrength = material.userData.rim.strength;
    shader.uniforms.uRimPower = material.userData.rim.power;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRimColor;
        uniform vec3 uRimDir;
        uniform float uRimStrength;
        uniform float uRimPower;`,
      )
      .replace(
        '#include <opaque_fragment>',
        `{
          vec3 rimView = normalize( vViewPosition );
          float rimFresnel = pow( 1.0 - saturate( dot( normal, rimView ) ), uRimPower );
          float rimSide = smoothstep( -0.25, 0.85, dot( normal, uRimDir ) );
          outgoingLight += uRimColor * rimFresnel * rimSide * uRimStrength;
        }
        #include <opaque_fragment>`,
      );
  };
  // tutti i materiali vinile condividono lo stesso programma GPU
  material.customProgramCacheKey = () => 'vinyl-rim';
  return material;
}

/** Abilita ombre portate/ricevute su tutto un sottoalbero. */
export function enableShadows(object, { cast = true, receive = true } = {}) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = cast && !o.material?.transparent;
      o.receiveShadow = receive;
    }
  });
}
