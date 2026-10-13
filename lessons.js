"use strict";

const LessonScenes = (() => {
  const lessons = [
    { id: "chicken-wing", audio: "audio/lessons/chicken-wing.mp3", name: "Chicken Wing", kind: "lesson", image: "images/lessons/chicken-wing.svg", duration: 5 },
    { id: "wash-hands", audio: "audio/lessons/wash-hands.mp3", name: "Wash Hands", kind: "lesson", image: "images/lessons/wash-hands.svg", duration: 5 },
  ];
  const clamp = (n) => Math.max(0, Math.min(1, n));
  const ease = (n) => { const t = clamp(n); return t * t * (3 - 2 * t); };

  function frame(id, seconds, reduced = false) {
    if (id === "chicken-wing") {
      const raised = reduced ? 1 : ease((seconds - 0.3) / 1.2) * (1 - ease((seconds - 3.8) / 1.0));
      const coughing = seconds >= 1.8 && seconds < 3.5;
      return {
        upper: 95 - 133 * raised,
        lower: -30 + 12 * raised,
        lean: raised * 12,
        bounce: coughing && !reduced ? Math.sin((seconds - 1.8) * Math.PI * 5) * 1.5 : 0,
        cough: coughing,
        done: seconds >= 5,
      };
    }
    // A short visual demonstration, not a handwashing timer.
    const phase = seconds < 0.65 ? "wet" : seconds < 1.1 ? "soap" : seconds < 3.5 ? "scrub" : seconds < 4.2 ? "rinse" : "dry";
    return {
      phase,
      area: seconds < 2.2 ? "palms" : seconds < 2.8 ? "backs" : "fingers",
      rub: phase === "scrub" && !reduced ? Math.sin(seconds * 12) * 10 : 0,
      flow: reduced ? 0 : seconds * 30,
      water: phase === "wet" || phase === "rinse",
      bubbles: phase === "soap" || phase === "scrub",
      towel: phase === "dry",
      done: seconds >= 5,
    };
  }

  function markup(id) {
    const rest = frame(id, 0);
    // Front view throughout. Both arms wear the same long-sleeved shirt.
    // The near arm uses a fixed shoulder, upper-arm length and forearm length;
    // the forearm rises toward the opposite ear as the upper arm crosses the chest.
    const chicken = `<ellipse cx="200" cy="386" rx="100" ry="11" fill="#d4d9d0" stroke="none"/>
      <g data-part="kid">
        <path d="M160 295v70h31l9-62 9 62h31v-70Z" fill="#5777ad"/>
        <path d="M158 362h34v18h-53q-2-14 19-18m50 0h34q20 4 19 18h-53Z" fill="#f4bb57"/>
        <path d="M249 222q25 34 22 63l-7 46" fill="none" stroke="#3b3544" stroke-width="31"/>
        <path d="M249 222q25 34 22 63l-7 46" fill="none" stroke="#7bbbaa" stroke-width="23"/>
        <path d="m264 332-2 15" fill="none" stroke="#3b3544" stroke-width="24"/>
        <path d="m264 332-2 15" fill="none" stroke="#dba27b" stroke-width="17"/>
        <path d="M145 210q55-30 106 0l-4 94q-45 17-96 0Z" fill="#7bbbaa"/>
        <path d="M184 166v31q16 17 32 0v-31" fill="#dba27b"/>
        <path d="M181 200q19 19 38 0" fill="none" stroke="#467d70" stroke-width="4"/>
        <g data-part="head" transform="rotate(${rest.lean} 200 177)">
          <ellipse cx="148" cy="126" rx="10" ry="16" fill="#dba27b"/>
          <ellipse cx="250" cy="126" rx="10" ry="16" fill="#dba27b"/>
          <path d="M150 98q0-49 49-49t49 49v30q-2 47-49 48-47-1-49-48Z" fill="#dba27b"/>
          <path d="M149 108q-15-52 22-68 33-16 64 5 24 16 16 61l-12-26q-29 4-43-20-13 23-43 25Z" fill="#614431"/>
          <path d="M173 119h7m37 0h7" fill="none"/>
          <path d="m199 123-4 15h10" fill="none" stroke="#b77957" stroke-width="3"/>
          <path d="M199 153q7 5 14 0" fill="none" stroke="#6e443a" stroke-width="4"/>
        </g>
        <g transform="translate(160 214)">
          <g data-part="upper" transform="rotate(${rest.upper})">
            <path d="M0 0H75" fill="none" stroke="#3b3544" stroke-width="34"/>
            <path d="M0 0H75" fill="none" stroke="#7bbbaa" stroke-width="26"/>
            <g transform="translate(75 0)">
              <g data-part="lower" transform="rotate(${rest.lower})">
                <path d="M0 0H48" fill="none" stroke="#3b3544" stroke-width="30"/>
                <path d="M0 0H48" fill="none" stroke="#7bbbaa" stroke-width="22"/>
                <path d="M52 0H65" fill="none" stroke="#3b3544" stroke-width="23"/>
                <path d="M52 0H65" fill="none" stroke="#dba27b" stroke-width="16"/>
                <path d="M48-10v20" fill="none" stroke="#467d70" stroke-width="3"/>
              </g>
              <path d="M-12 3q-1-8 6-10" fill="none" stroke="#467d70" stroke-width="3"/>
            </g>
          </g>
        </g>
        <g data-part="cough" stroke="#8268aa" stroke-width="4" opacity="0"><path d="m250 163 10-5m-7 18h13m-15 12 10 5" fill="none"/></g>
      </g>`;
    const hand = `<path d="M-86 22h35l19-13 20-7 27-32q8-7 13 0l-18 26 29-20q10-5 13 4L27 2l31-13q12-3 12 7L36 14l25-5q12 0 10 10L24 41q-21 15-45 3l-30-4h-35Z" fill="#dba27b"/>
      <path d="M-10 27 12 8m8 21 21-12" fill="none" stroke="#b77957" stroke-width="3"/>`;
    const wash = `<rect x="28" y="301" width="344" height="80" rx="24" fill="#b5dce1"/>
      <ellipse cx="200" cy="304" rx="158" ry="40" fill="#e5f4f3"/>
      <ellipse cx="200" cy="315" rx="25" ry="8" fill="#96b4bc"/>
      <path d="M290 280V87q0-33-33-33h-24q-30 0-30 33v17h28V91q0-9 10-9h16q6 0 6 9v189" fill="#a1b5c2"/>
      <path d="M282 135h35v-19" fill="none" stroke="#3b3544" stroke-width="10"/>
      <g data-part="water" opacity="0" stroke="#64badd" stroke-width="7"><path d="M207 112v150m12-150v153m12-153v145" fill="none" stroke-dasharray="12 10"/></g>
      <g data-part="soap"><rect x="40" y="150" width="57" height="87" rx="13" fill="#e2c089"/><path d="M67 150v-23h30m-18 0v-10" fill="none" stroke-width="8"/><path d="M55 177h28v35H55Z" fill="#fff5de"/></g>
      <g data-part="hands">
        <g transform="translate(179 226)"><g data-part="left-hand">${hand}</g></g>
        <g transform="translate(243 253) rotate(180)"><g data-part="right-hand">${hand}</g></g>
      </g>
      <g data-part="bubbles" stroke="#79b6c9" stroke-width="2" fill="#f6ffff">
        <circle cx="177" cy="206" r="17"/><circle cx="200" cy="218" r="21"/><circle cx="226" cy="209" r="14"/><circle cx="215" cy="239" r="17"/><circle cx="173" cy="237" r="14"/><circle cx="193" cy="189" r="10"/><circle cx="237" cy="183" r="8"/>
      </g>
      <g data-part="towel" opacity="0"><path d="M128 191q71-15 141 0v91q-73 17-141 0Z" fill="#f4d48e"/><path d="M139 203v66m14-70v73m93-70v68m12-67v63" fill="none" stroke="#dfb76a" stroke-width="4"/></g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 410" role="img" aria-label="${id === 'chicken-wing' ? 'A cartoon child raises a bent arm and coughs into the inside of their elbow, with their hand away from their face.' : 'Hands get wet, use soap, rub together with soap, rinse, and dry with a towel.'}"><g stroke="#3b3544" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">${id === 'chicken-wing' ? chicken : wash}</g></svg>`;
  }

  function paint(root, id, state) {
    const part = (name) => root.querySelector(`[data-part="${name}"]`);
    const show = (name, visible) => part(name).setAttribute("opacity", visible ? "1" : "0");
    if (id === "chicken-wing") {
      part("upper").setAttribute("transform", `rotate(${state.upper})`);
      part("lower").setAttribute("transform", `rotate(${state.lower})`);
      part("kid").setAttribute("transform", `translate(${state.bounce} ${state.bounce / 2})`);
      part("head").setAttribute("transform", `rotate(${state.lean} 200 177)`);
      show("cough", state.cough);
    } else {
      show("water", state.water);
      show("bubbles", state.bubbles);
      show("towel", state.towel);
      part("water").setAttribute("stroke-dashoffset", -state.flow);
      const angle = state.phase === "scrub" && state.area === "backs" ? 14 : state.phase === "scrub" && state.area === "fingers" ? -14 : 0;
      part("left-hand").setAttribute("transform", `translate(${state.rub} 0) rotate(${angle})`);
      part("right-hand").setAttribute("transform", `translate(${state.rub} 0) rotate(${-angle})`);
    }
  }
  return { lessons, frame, markup, paint };
})();
if (typeof module !== "undefined") module.exports = LessonScenes;
