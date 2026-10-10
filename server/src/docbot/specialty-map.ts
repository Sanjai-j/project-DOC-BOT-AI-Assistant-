/**
 * Maps a disease name (lowercase) from the knowledge base to one of the app's
 * specialties. Ordered rules — first match wins; falls back to General
 * Physician. Keeps DocBot suggestions aligned with the doctors actually
 * available for booking.
 */

export const SPECIALTIES = [
  'ENT',
  'Cardiologist',
  'Dermatologist',
  'Orthopedic',
  'Pediatrician',
  'General Physician',
  'Neurologist',
  'Psychiatrist',
  'Gynecologist',
  'Ophthalmologist',
  'Dentist',
  'Pulmonologist',
  'Gastroenterologist',
  'Urologist',
  'Endocrinologist',
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

/** Ordered disease-name -> specialty rules (substring match, first hit wins). */
const DISEASE_RULES: Array<[RegExp, Specialty]> = [
  // TMJ / jaw-joint disorders are dental/oral-medicine, not orthopedics
  [/\b(temporomandibular|tmj|jaw joint)\b/, 'Dentist'],
  // Mental / behavioral health (before Neurologist — many overlap keywords)
  [/\b(depress|anxiety|panic|phobia|obsess|bipolar|psychosis|schizo|eating disorder|ptsd|adhd|autism|sleep disorder|somatoform|conversion disorder|personality disorder|suicid)/, 'Psychiatrist'],

  // Ear / nose / throat
  [/\b(otitis|tinnitus|hearing|ear |labyrinth|vestibular|meniere|sinus|nasal|nose|rhinitis|pharyngitis|tonsil|laryng|voice|vocal cord|throat|epiglottis|salivary gland|tongue tie)/, 'ENT'],

  // Heart & vessels
  [/\b(cardiac|cardio|heart|coronary|angina|myocard|pericard|arrhythm|atrial|ventricular|endocard|hypertension|atherosclero|artery|aneurysm|thrombophlebitis|varicose|vascul|embolism|hypotension)/, 'Cardiologist'],

  // Lungs
  [/\b(asthma|bronch|pneumon|copd|emphysema|pleur|lung|pulmonary|tuberculosis|laryngotrache|cystic fibrosis|atelectasis|pneumoconiosis|sarcoidosis|sleep apnea)/, 'Pulmonologist'],

  // Skin & hair
  [/\b(skin|dermat|eczema|psoriasis|acne|urticaria|hives|melanoma|carcinoma of the skin|rash|follicul|cellulitis|burn|alopecia|hair|nail|scar|wart|mole|lichen|impetigo)/, 'Dermatologist'],

  // Bones, joints, muscles
  [/\b(osteoarth|arthritis|rheumat|gout|spondy|spine|scoliosis|kyphosis|fracture|dislocation|sprain|rotator cuff|tendon|bursitis|frozen shoulder|bone|osteopor|osteomalacia|paget|joint|knee|hip |shoulder|elbow|wrist|ankle|carpal|dupuytren|plantar fasci|muscular dystrophy|myasthenia|polymyalgia|fibromyalgia|torticollis)/, 'Orthopedic'],

  // Children (before gender/organ rules — pediatric variants win)
  [/\b(infant|neonat|newborn|child|children|pediatric|paediatric|croup|cradle cap|colic|chickenpox of childhood|measles|rubella|whooping cough|roseola|hand foot and mouth|kawasaki|cry|feeding problem|bedwetting|potty|vaccination|growth)/, 'Pediatrician'],

  // Women's health
  [/\b(menstru|menstrual|period|pregnan|obstetr|vagin|vulv|cervic|uter|ovari|endometri|menopaus|pcos|pcod|breast|lactation|contracep|infertility|miscarriage|pms|premenstrual|dyspareunia|pelvic inflammatory|fibroid)/, 'Gynecologist'],

  // Eyes
  [/\b(eye|conjunctiv|vision|retina|retinal|cornea|corneal|glaucoma|cataract|iris|uveal|macula|optic nerve|eyelid|lacrimal|myopia|hyperopia|astigmatism|strabismus|amblyopia|keratitis|blephar)/, 'Ophthalmologist'],

  // Teeth & mouth
  [/\b(dental|tooth|teeth|gingiv|periodont|oral|mouth|stomat|abscess of the mouth|lip |salivary duct|orthodont|caries|cavity)/, 'Dentist'],

  // Urinary & male reproductive
  [/\b(urinar|bladder|kidney|renal|ureter|urethr|nephro|pyelonephritis|glomerul|cystitis|incontinence|prostat|testic|scrotum|penis|epididym|cryptorchid|hydrocele|varicocele|erectile)/, 'Urologist'],

  // Hormones
  [/\b(diabet|thyroid|parathyroid|adrenal|cushing|addison|pituitary|acromegaly|prolactin|hormon|goiter|hypoglycem|hyperglycem|obesity|metabolic syndrome|gout of metabolic origin|insulin)/, 'Endocrinologist'],

  // Brain & nerves (after Psychiatrist so mental-health terms route there)
  [/\b(epilep|seizure|migraine|headache|stroke|transient ischemic|parkinson|alzheimer|dementia|neurop|nerve|brain|cerebr|cerebel|mening|multiple sclerosis|vertigo|dizzy|concussion|tremor|dystonia|ataxia|paralysis|bell|encephal|hydrocephalus|spina bifida|narcolepsy)/, 'Neurologist'],

  // Stomach & digestion
  [/\b(gastr|esophag|reflux|duoden|colitis|colon|rectal|rectum|bowel|intestin|appendic|pancreat|hepat|liver|gallbladder|gallstone|bile|cirrhosis|hemorrhoid|anal fissure|hernia|celiac|crohn|diverticul|dyspeps|indigest|constip|diarrh|nausea|vomit|flatulen|bloat|irritable bowel|jaundice|ascites)/, 'Gastroenterologist'],

  // Blood & systemic — General Physician keeps the widest catch
  [/\b(anemia|leukemia|lymphoma|hemophilia|clotting|sepsis|infection|fever|flu|common cold|covid|dengue|malaria|allerg|anaphyla|immun|vitamin defic|malnutrition|dehydration|fatigue|poison|overdose|alcohol|smoking|obesity)/, 'General Physician'],
];

/** Injury / trauma catch-all that beats organ rules when the name mentions injury. */
const INJURY_RULE: RegExp = /\b(injury|trauma|wound|fracture)\b/;

export function assignSpecialty(diseaseName: string): Specialty {
  const name = diseaseName.toLowerCase();
  if (INJURY_RULE.test(name)) {
    // Injuries route by body region so "injury to the knee" stays Orthopedic,
    // while "injury to the eye" still lands with the eye doctor.
    if (/\b(eye|ear|mouth|tongue|tooth|teeth)\b/.test(name)) {
      if (/\b(eye)\b/.test(name)) return 'Ophthalmologist';
      if (/\b(ear)\b/.test(name)) return 'ENT';
      return 'Dentist';
    }
    return 'Orthopedic';
  }
  for (const [re, specialty] of DISEASE_RULES) {
    if (re.test(name)) return specialty;
  }
  return 'General Physician';
}
