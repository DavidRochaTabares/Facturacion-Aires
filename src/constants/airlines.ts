// Static suggestions for the flight form's "Aerolínea" field. The field also accepts any free text, so nothing needs to be registered beforehand.
const sort = (l: string[]) => [...l].sort((a, b) => a.localeCompare(b, 'es'))

const COLOMBIA = ['Avianca', 'LATAM Airlines Colombia', 'Clic Air', 'Wingo', 'SATENA', 'Easyfly', 'Searca', 'Aerolínea de Antioquia (ADA)', 'Copa Airlines Colombia', 'Avianca Cargo']

const AMERICA = [
  'Copa Airlines', 'LATAM Airlines', 'LATAM Airlines Brasil', 'LATAM Airlines Perú', 'LATAM Airlines Ecuador', 'LATAM Airlines Chile', 'Avianca Ecuador', 'Avianca Costa Rica', 'Avianca El Salvador',
  'American Airlines', 'Delta Air Lines', 'United Airlines', 'JetBlue', 'Southwest Airlines', 'Spirit Airlines', 'Frontier Airlines', 'Alaska Airlines', 'Hawaiian Airlines', 'Allegiant Air', 'Sun Country Airlines',
  'Air Canada', 'WestJet', 'Air Transat', 'Porter Airlines',
  'Aeroméxico', 'Volaris', 'Viva Aerobus',
  'GOL', 'Azul', 'Aerolíneas Argentinas', 'Flybondi', 'JetSMART', 'Sky Airline', 'Boliviana de Aviación (BoA)', 'Paranair', 'Conviasa', 'Arajet',
  'Cubana de Aviación', 'Caribbean Airlines', 'Cayman Airways', 'Bahamasair', 'interCaribbean Airways', 'Air Panama', 'Aruba Airlines', 'Surinam Airways', 'Air Century', 'Sky High Aviation Services',
]

const OTHERS = ['Iberia', 'Air Europa', 'KLM', 'Air France', 'Lufthansa', 'British Airways', 'TAP Air Portugal', 'Turkish Airlines', 'Emirates', 'Qatar Airways', 'Plus Ultra', 'Level', 'Iberojet', 'Edelweiss Air']

/** Colombian airlines first, then the rest of the Americas, then other carriers that commonly serve Colombia; each block alphabetical. */
export const AIRLINES: string[] = [...new Set([...sort(COLOMBIA), ...sort(AMERICA), ...sort(OTHERS)])]
