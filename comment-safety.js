(function (root) {
  const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu;
  const PHONE = /(?<!\d)(?:\+81[-ー－\s]?)?0\d(?:[-ー－\s]?\d){8,9}(?!\d)|(?<!\d)\+81[-ー－\s]?[1-9](?:[-ー－\s]?\d){8,9}(?!\d)/gu;
  const SNS_HANDLE = /(?<![\p{L}\p{N}])@[A-Z0-9_]{2,30}\b/giu;
  const PREFECTURES = "北海道|東京都|京都府|大阪府|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県";
  const JAPANESE_ADDRESS = new RegExp(
    `(?:${PREFECTURES})[^\\s、。！？]{0,24}?(?:市|区|町|村)[^\\s、。！？]{0,12}?(?:\\d{1,4}丁目\\d{0,4}番?地?|\\d{1,4}番地?(?:\\d{1,4}号)?|\\d{1,4}[-－ー]\\d{1,4}(?:[-－ー]\\d{1,4})?)`,
    "gu",
  );

  function redactLineIds(text) {
    return text.replace(/(?:LINE|ライン)\s*(?:ID|ＩＤ)\s*(?:は|[:：＝=])?\s*[A-Z0-9._-]{3,40}/giu, "LINE IDは[SNSアカウント]");
  }

  function redactPersonalInfo(input) {
    let text = String(input ?? "");
    text = text.replace(JAPANESE_ADDRESS, "[住所]");
    text = text.replace(EMAIL, "[メールアドレス]");
    text = text.replace(PHONE, "[電話番号]");
    text = redactLineIds(text);
    text = text.replace(SNS_HANDLE, "[SNSアカウント]");
    return text;
  }

  function normalizeComment(input) {
    const text = redactPersonalInfo(String(input ?? "").trim());
    const length = Array.from(text).length;
    return length >= 1 && length <= 280 ? text : null;
  }

  function normalizeNickname(input) {
    return redactPersonalInfo(String(input ?? "").trim()).slice(0, 40);
  }

  root.ProjectCommentSafety = Object.freeze({ redactPersonalInfo, normalizeComment, normalizeNickname });
})(globalThis);
