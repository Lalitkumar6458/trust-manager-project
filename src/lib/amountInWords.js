// Amount in words – Indian numbering system (Crore / Lakh / Thousand), English and Hindi.

const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function en2(n) {
  if (n < 20) return EN_ONES[n];
  return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${EN_ONES[n % 10]}` : ''}`;
}

function en3(n) {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${EN_ONES[h]} Hundred` : '', r ? en2(r) : ''].filter(Boolean).join(' ');
}

function indianParts(n) {
  // returns { crore, lakh, thousand, rest } where crore can be > 99
  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  const rest = n % 1000;
  return { crore, lakh, thousand, rest };
}

function enInt(n) {
  if (n === 0) return 'Zero';
  const { crore, lakh, thousand, rest } = indianParts(n);
  const out = [];
  if (crore) out.push(`${enInt(crore)} Crore`);
  if (lakh) out.push(`${en2(lakh)} Lakh`);
  if (thousand) out.push(`${en2(thousand)} Thousand`);
  if (rest) out.push(en3(rest));
  return out.join(' ');
}

export function amountInWordsEn(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const rupees = Math.floor(v / 100);
  const paise = v % 100;
  let s = `Rupees ${enInt(rupees)}`;
  if (paise) s += ` and ${en2(paise)} Paise`;
  return `${s} Only`;
}

// ---------------- Hindi ----------------
const HI = [
  'शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ',
  'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस',
  'बीस', 'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस',
  'तीस', 'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस',
  'चालीस', 'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास',
  'पचास', 'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ',
  'साठ', 'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर',
  'सत्तर', 'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी',
  'अस्सी', 'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी',
  'नब्बे', 'इक्यानबे', 'बानबे', 'तिरानबे', 'चौरानबे', 'पंचानबे', 'छियानबे', 'सत्तानबे', 'अट्ठानबे', 'निन्यानबे',
];

function hiInt(n) {
  if (n === 0) return HI[0];
  const { crore, lakh, thousand, rest } = indianParts(n);
  const out = [];
  if (crore) out.push(`${hiInt(crore)} करोड़`);
  if (lakh) out.push(`${HI[lakh]} लाख`);
  if (thousand) out.push(`${HI[thousand]} हज़ार`);
  const h = Math.floor(rest / 100);
  const r = rest % 100;
  if (h) out.push(`${HI[h]} सौ`);
  if (r) out.push(HI[r]);
  return out.join(' ');
}

export function amountInWordsHi(amount) {
  const v = Math.round(Math.abs(Number(amount) || 0) * 100);
  const rupees = Math.floor(v / 100);
  const paise = v % 100;
  let s = `${hiInt(rupees)} रुपये`;
  if (paise) s += ` ${HI[paise]} पैसे`;
  return `${s} मात्र`;
}
