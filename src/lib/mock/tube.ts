import { curvedHop } from '../tube/curve';
import type { TubeHop, TubeLine, TubeNetwork, TubeStation } from '../types';

/**
 * Mock TfL data: four lines through the demo area, official line colours,
 * approximate real station coordinates. The real build swaps this for the
 * TfL Unified API (Line/Route/Sequence + StopPoints) — same shape.
 */

// Official TfL line colours (kept complete so extra lines can be added later).
export const TFL_COLOURS: Record<string, string> = {
  central: '#E32017',
  victoria: '#0098D4',
  jubilee: '#A0A5A9',
  elizabeth: '#6950A1',
  piccadilly: '#003688',
  district: '#00782A',
  bakerloo: '#B36305',
  northern: '#000000',
  metropolitan: '#9B0056',
  circle: '#FFD300',
  hammersmith: '#F3A9BB',
  overground: '#EE7C0E',
  dlr: '#00A4A7',
};

type Raw = [id: string, name: string, lng: number, lat: number];

const STATIONS: Raw[] = [
  // Central line
  ['notting-hill', 'Notting Hill Gate', -0.1963, 51.5094],
  ['queensway', 'Queensway', -0.1874, 51.5104],
  ['lancaster-gate', 'Lancaster Gate', -0.1756, 51.5119],
  ['marble-arch', 'Marble Arch', -0.1586, 51.5136],
  ['bond-street', 'Bond Street', -0.1494, 51.5142],
  ['oxford-circus', 'Oxford Circus', -0.1415, 51.5152],
  ['tottenham-court-road', 'Tottenham Court Road', -0.1308, 51.5165],
  ['holborn', 'Holborn', -0.12, 51.5174],
  ['chancery-lane', 'Chancery Lane', -0.1111, 51.5185],
  ['st-pauls', "St Paul's", -0.0973, 51.5146],
  ['bank', 'Bank', -0.0886, 51.5133],
  ['liverpool-street', 'Liverpool Street', -0.0823, 51.5178],
  ['bethnal-green', 'Bethnal Green', -0.0549, 51.5273],
  // Victoria line
  ['brixton', 'Brixton', -0.1145, 51.4627],
  ['stockwell', 'Stockwell', -0.1226, 51.4722],
  ['vauxhall', 'Vauxhall', -0.1236, 51.4861],
  ['pimlico', 'Pimlico', -0.1334, 51.4893],
  ['victoria', 'Victoria', -0.1441, 51.4965],
  ['green-park', 'Green Park', -0.1428, 51.5067],
  ['warren-street', 'Warren Street', -0.1384, 51.5247],
  ['euston', 'Euston', -0.1327, 51.5282],
  ['kings-cross', "King's Cross St Pancras", -0.1238, 51.5308],
  // Jubilee line
  ['baker-street', 'Baker Street', -0.1571, 51.5226],
  ['westminster', 'Westminster', -0.1254, 51.501],
  ['waterloo', 'Waterloo', -0.1134, 51.5036],
  ['southwark', 'Southwark', -0.1052, 51.504],
  ['london-bridge', 'London Bridge', -0.0864, 51.5052],
  ['bermondsey', 'Bermondsey', -0.0637, 51.4979],
  ['canada-water', 'Canada Water', -0.0502, 51.4982],
  ['canary-wharf', 'Canary Wharf', -0.0209, 51.5036],
  // Elizabeth line
  ['paddington', 'Paddington', -0.1774, 51.5154],
  ['farringdon', 'Farringdon', -0.1045, 51.5203],
  ['whitechapel', 'Whitechapel', -0.0612, 51.5194],
];

const LINES: Array<{
  id: string;
  name: string;
  mode: 'tube' | 'elizabeth-line';
  hopMinutes: number;
  stations: string[];
}> = [
  {
    id: 'central',
    name: 'Central',
    mode: 'tube',
    hopMinutes: 1.8,
    stations: [
      'notting-hill', 'queensway', 'lancaster-gate', 'marble-arch', 'bond-street',
      'oxford-circus', 'tottenham-court-road', 'holborn', 'chancery-lane',
      'st-pauls', 'bank', 'liverpool-street', 'bethnal-green',
    ],
  },
  {
    id: 'victoria',
    name: 'Victoria',
    mode: 'tube',
    hopMinutes: 1.9,
    stations: [
      'brixton', 'stockwell', 'vauxhall', 'pimlico', 'victoria', 'green-park',
      'oxford-circus', 'warren-street', 'euston', 'kings-cross',
    ],
  },
  {
    id: 'jubilee',
    name: 'Jubilee',
    mode: 'tube',
    hopMinutes: 2.0,
    stations: [
      'baker-street', 'bond-street', 'green-park', 'westminster', 'waterloo',
      'southwark', 'london-bridge', 'bermondsey', 'canada-water', 'canary-wharf',
    ],
  },
  {
    id: 'elizabeth',
    name: 'Elizabeth',
    mode: 'elizabeth-line',
    hopMinutes: 2.6,
    stations: [
      'paddington', 'bond-street', 'tottenham-court-road', 'farringdon',
      'liverpool-street', 'whitechapel',
    ],
  },
];

export function buildTube(): TubeNetwork {
  const stations: TubeStation[] = STATIONS.map(([id, name, lng, lat]) => ({
    id,
    name,
    pos: [lng, lat],
    lines: [],
  }));
  const stationIndex = new Map(stations.map((s, i) => [s.id, i] as const));
  const lines: TubeLine[] = LINES.map((l) => ({ id: l.id, name: l.name, color: TFL_COLOURS[l.id], mode: l.mode }));
  const hops: TubeHop[] = [];
  LINES.forEach((l, li) => {
    for (const sid of l.stations) {
      const s = stations[stationIndex.get(sid)!];
      if (!s.lines.includes(l.id)) s.lines.push(l.id);
    }
    const pos = l.stations.map((sid) => stations[stationIndex.get(sid)!].pos);
    for (let i = 1; i < l.stations.length; i++) {
      hops.push({
        line: li,
        a: stationIndex.get(l.stations[i - 1])!,
        b: stationIndex.get(l.stations[i])!,
        minutes: l.hopMinutes,
        geom: curvedHop(pos[i - 2] ?? pos[i - 1], pos[i - 1], pos[i], pos[i + 1] ?? pos[i]),
      });
    }
  });
  return { lines, stations, hops, stationIndex };
}
