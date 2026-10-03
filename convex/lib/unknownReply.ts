const unknownCopy: Record<string, string> = {
  en: "I do not have verified information about that yet. Please contact the host here for help.",
  th: "ยังไม่มีข้อมูลที่ยืนยันแล้วเกี่ยวกับเรื่องนี้ กรุณาติดต่อเจ้าของที่พักในแชตนี้เพื่อขอความช่วยเหลือ",
  ko: "아직 확인된 정보가 없습니다. 이 채팅에서 호스트에게 문의해 주세요.",
  "zh-CN": "目前没有经过确认的信息。请在此聊天中联系房东。",
  ja: "確認済みの情報がありません。このチャットでホストにお問い合わせください。",
  fr: "Je n’ai pas encore d’information vérifiée. Veuillez contacter l’hôte ici.",
  de: "Dazu habe ich noch keine bestätigten Informationen. Bitte kontaktieren Sie hier den Gastgeber.",
  es: "Aún no tengo información verificada. Contacta con el anfitrión aquí.",
  ru: "Подтверждённой информации пока нет. Свяжитесь с хозяином здесь.",
  it: "Non ho ancora informazioni verificate. Contatta qui il proprietario.",
  hi: "अभी सत्यापित जानकारी नहीं है। कृपया इस चैट में मेज़बान से संपर्क करें।",
};

export function unknownReply(locale?: string | null) {
  const reply = locale ? unknownCopy[locale] : undefined;
  return typeof reply === "string" ? reply : unknownCopy.en;
}
