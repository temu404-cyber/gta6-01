// The story of Solmar Bay: 8 missions for Dana Moreno, working for the
// fixer Rosa Delgado and the Breakwater crew. Each mission is a list of
// steps; the game advances a step when its condition is met. Dialog lines
// play at the start of a mission and at key beats.
import { PLACES } from './world.js';

export const MISSION_COUNT = 8;

/**
 * Step types:
 *  goto   - reach a point (on foot or in a car)
 *  talk   - stand at a point and press E
 *  steal  - get into any car that is not yours
 *  drive  - reach a point while driving a car
 *  deliver- reach a point within a time limit (timer counts down)
 *  chase  - stay within 120px of a moving target car for 3 seconds
 *  fight  - defeat every spawned enemy
 *  escape - bring the wanted level to 0
 *  taxi   - complete N taxi fares
 *  pickup - stand at a point and press E to grab something
 */
export const MISSIONS = [
  {
    id: 1,
    title: 'Homecoming',
    reward: 100,
    intro: [
      { who: 'Dana', text: 'Solmar Bay. Five years away, and the place still smells like salt and bad decisions.' },
      { who: 'Rosa', text: 'Dana Moreno! You look terrible. Come to my office — I have work, and you have debts.' },
      { who: 'Dana', text: 'Debts I did not make. But work is work. Where is the office?' },
      { who: 'Rosa', text: 'Downtown, by the plaza. Follow the yellow marker. Walk — the bus already left without you.' },
    ],
    steps: [
      { type: 'goto', x: PLACES.rosaOffice.x, y: PLACES.rosaOffice.y, label: "Go to Rosa's office downtown" },
      { type: 'talk', x: PLACES.rosaOffice.x, y: PLACES.rosaOffice.y, label: 'Talk to Rosa (press E)' },
    ],
    outro: [
      { who: 'Rosa', text: 'Good. The Breakwater crew looks after its own. First job: we need wheels. Borrow some.' },
    ],
  },
  {
    id: 2,
    title: 'Borrowed Wheels',
    reward: 250,
    intro: [
      { who: 'Rosa', text: 'A client needs a clean sedan, no questions. Take any car on the street — just do not do it in front of a cop.' },
      { who: 'Dana', text: 'Borrow. Right. And then?' },
      { who: 'Rosa', text: 'Bring it to the chop shop on the east side. Yellow marker. Try not to scratch it.' },
    ],
    steps: [
      { type: 'steal', label: 'Take a car (walk up to one and press E)' },
      { type: 'drive', x: PLACES.chopShop.x, y: PLACES.chopShop.y, label: 'Deliver the car to the Chop Shop' },
    ],
    outro: [
      { who: 'Rosa', text: 'Clean work. The client is happy. You are officially on the crew now, Dana.' },
    ],
  },
  {
    id: 3,
    title: 'Night Run',
    reward: 300,
    intro: [
      { who: 'Rosa', text: 'A package has to reach the Night Market before the stalls close. It is fragile. It is also none of your business.' },
      { who: 'Dana', text: 'Fragile how? Ticking fragile?' },
      { who: 'Rosa', text: 'Drive, Dana. The marker is waiting. Do not be late.' },
    ],
    steps: [
      { type: 'pickup', x: PLACES.rosaOffice.x, y: PLACES.rosaOffice.y, label: 'Pick up the package at the office (E)' },
      { type: 'deliver', x: PLACES.market.x, y: PLACES.market.y, label: 'Deliver the package to the Night Market', time: 75 },
    ],
    outro: [
      { who: 'Rosa', text: 'On time. The client sends his regards, and a bonus for the careful driving.' },
    ],
  },
  {
    id: 4,
    title: 'Tail Trouble',
    reward: 350,
    intro: [
      { who: 'Rosa', text: 'A rival courier is running our routes and undercutting us. Find his car — the red sport coupe near the plaza — and stay on his tail until he gives up the route.' },
      { who: 'Dana', text: 'A chase. In traffic. Wonderful.' },
      { who: 'Rosa', text: 'Do not wreck him. Just make him nervous enough to talk.' },
    ],
    steps: [
      { type: 'chase', label: 'Chase the red coupe — stay close for 3 seconds' },
    ],
    outro: [
      { who: 'Rosa', text: 'He talked. The route is ours again. You drive like you mean it, Dana.' },
    ],
  },
  {
    id: 5,
    title: 'Dockside Deal',
    reward: 400,
    intro: [
      { who: 'Rosa', text: 'The harbor crew shorted us on a shipment. They are waiting at the docks with guns and excuses. Take the Breakwater boys — no, take yourself. You are cheaper.' },
      { who: 'Dana', text: 'You are all heart, Rosa.' },
      { who: 'Rosa', text: 'Deal with them, then come home. And Dana — shoot straight.' },
    ],
    steps: [
      { type: 'goto', x: PLACES.port.x, y: PLACES.port.y, label: 'Go to the Harbor Docks' },
      { type: 'fight', label: 'Deal with the harbor crew (4 armed)' },
    ],
    outro: [
      { who: 'Rosa', text: 'The docks are ours again. The crew is starting to respect you, Dana. Careful — respect is expensive.' },
    ],
  },
  {
    id: 6,
    title: 'Heat',
    reward: 450,
    intro: [
      { who: 'Rosa', text: 'The police raided the market stall. They know your face now, Dana. Lose them — get out of sight, stay quiet, and let the heat die down.' },
      { who: 'Dana', text: 'Every cop in Solmar Bay is looking for me?' },
      { who: 'Rosa', text: 'Then do not get caught. The safehouse is marked if you need it.' },
    ],
    steps: [
      { type: 'escape', label: 'Lose the police — get your wanted level to zero' },
    ],
    outro: [
      { who: 'Rosa', text: 'Clean. You vanished like smoke. The crew could use a ghost like you.' },
    ],
  },
  {
    id: 7,
    title: 'Taxi Nights',
    reward: 500,
    intro: [
      { who: 'Rosa', text: 'Quiet work tonight: drive a cab, two fares, cash in hand. The city talks to cab drivers, Dana. Listen.' },
      { who: 'Dana', text: 'Two fares. No guns, no cops, no packages that tick.' },
      { who: 'Rosa', text: 'That is the idea. Take any yellow taxi and press T to start.' },
    ],
    steps: [
      { type: 'taxi', count: 2, label: 'Complete 2 taxi fares (drive a taxi, press T)' },
    ],
    outro: [
      { who: 'Rosa', text: 'The passengers talked, all right. The bank on Bay Street is moving cash on Thursday. Remember that.' },
    ],
  },
  {
    id: 8,
    title: 'The Breakwater Job',
    reward: 1000,
    intro: [
      { who: 'Rosa', text: 'Thursday is here. Bay Trust Bank, one bag, in and out. The crew will handle the doors — you handle the bag and the getaway.' },
      { who: 'Dana', text: 'And if the police show up?' },
      { who: 'Rosa', text: 'They will. So drive like the whole city is behind you. Because it will be.' },
    ],
    steps: [
      { type: 'goto', x: PLACES.bank.x, y: PLACES.bank.y, label: 'Go to Bay Trust Bank' },
      { type: 'pickup', x: PLACES.bank.x, y: PLACES.bank.y, label: 'Grab the bag (press E)' },
      { type: 'escape', label: 'Escape the police and reach the Safehouse', safehouse: true },
    ],
    outro: [
      { who: 'Rosa', text: 'You did it, Dana. The debt is paid. Solmar Bay is yours again — all of it.' },
      { who: 'Dana', text: 'Then I am staying. This city owes me a future, and I intend to collect.' },
    ],
  },
];

/** Runtime state for the mission system. */
export function createMissionState() {
  return {
    index: 0, // mission 0..7, or 8 when the story is complete
    step: 0,
    timer: 0, // counts down for timed steps
    chaseTime: 0,
    taxiDone: 0,
    targetCar: null, // the chased coupe in mission 4
    enemies: [], // spawned for fight steps
    started: false, // intro dialog has played for the current mission
    done: false, // every mission complete
    banner: '', // short toast shown on step change
    bannerTimer: 0,
  };
}

export function currentMission(state) {
  if (state.index >= MISSIONS.length) return null;
  return MISSIONS[state.index];
}

export function currentStep(state) {
  const mission = currentMission(state);
  if (!mission) return null;
  return mission.steps[state.step] || null;
}

export function missionObjectiveLabel(state) {
  const mission = currentMission(state);
  if (!mission) return 'Story complete — Solmar Bay is yours. Free roam!';
  const step = currentStep(state);
  if (!step) return mission.title;
  return `${mission.title}: ${step.label}`;
}

/** Position of the current objective marker, or null. */
export function missionTarget(state) {
  const step = currentStep(state);
  if (!step) return null;
  if (step.x !== undefined && step.y !== undefined) return { x: step.x, y: step.y };
  if (step.type === 'chase' && state.targetCar) return { x: state.targetCar.x, y: state.targetCar.y };
  if (step.type === 'fight' && state.enemies && state.enemies.length > 0) {
    // Point at the middle of the remaining crew.
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const e of state.enemies) {
      if (e.dead) continue;
      sx += e.x;
      sy += e.y;
      n += 1;
    }
    if (n > 0) return { x: sx / n, y: sy / n };
  }
  if (step.type === 'escape' && step.safehouse) return { x: PLACES.safehouse.x, y: PLACES.safehouse.y };
  return null;
}
