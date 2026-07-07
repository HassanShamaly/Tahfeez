/* =========================================================
   محرك مطابقة التلاوة — Tasmee' Matching Engine
   يطابق كلمات التعرف الصوتي مع نص الآيات (رسم عثماني)
   ========================================================= */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Matcher = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- تطبيع النص ----------
  function normalize(text) {
    let t = text;
    t = t.replace(/ٱ/g, 'ا');                                  // wasla -> alef
    t = t.replace(/[ؐ-ًؚ-ٟۖ-ۭ࣓-ࣿ]/g, ''); // حركات وعلامات
    t = t.replace(/ـ/g, '');                                        // تطويل
    t = t.replace(/وٰ/g, 'ا');                            // و + ألف خنجرية -> ا
    t = t.replace(/ىٰ/g, 'ى');                            // ى + ألف خنجرية -> ى
    t = t.replace(/ٰ/g, '');                                        // ألف خنجرية
    t = t.replace(/[ۥۦ]/g, '');                                // واو وياء صغيرتان
    t = t.replace(/[أإآ]/g, 'ا');                    // أ إ آ -> ا
    t = t.replace(/ة/g, 'ه');                                  // ة -> ه
    t = t.replace(/ى/g, 'ي');                                  // ى -> ي
    t = t.replace(/ؤ/g, 'و');                                  // ؤ -> و
    t = t.replace(/ئ/g, 'ي');                                  // ئ -> ي
    t = t.replace(/ء/g, '');                                        // ء
    t = t.replace(/[^ء-ي\s]/g, ' ');
    return t.replace(/\s+/g, ' ').trim();
  }

  function words(text) {
    const n = normalize(text);
    return n ? n.split(' ') : [];
  }

  // ---------- مسافة ليفنشتاين ----------
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    let prev = new Array(n + 1), cur = new Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
      cur[0] = i;
      for (let j = 1; j <= n; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      const tmp = prev; prev = cur; cur = tmp;
    }
    return prev[n];
  }

  function tolerance(len) {
    if (len <= 3) return 0;
    if (len <= 5) return 1;
    if (len <= 8) return 2;
    return 3;
  }

  function wordMatch(spoken, expected) {
    if (spoken === expected) return true;
    const L = Math.max(spoken.length, expected.length);
    if (lev(spoken, expected) <= tolerance(L)) return true;
    if (L >= 4 && (spoken.includes(expected) || expected.includes(spoken))
        && Math.abs(spoken.length - expected.length) <= 2) return true;
    return false;
  }

  // ---------- الحروف المقطعة ----------
  const LETTER_NAMES = {
    'ا': 'الف', 'ل': 'لام', 'م': 'ميم', 'ص': 'صاد', 'ر': 'را',
    'ك': 'كاف', 'ه': 'ها', 'ي': 'يا', 'ع': 'عين', 'ط': 'طا',
    'س': 'سين', 'ح': 'حا', 'ق': 'قاف', 'ن': 'نون'
  };
  const MUQATTAAT = new Set(['الم', 'المص', 'الر', 'المر', 'كهيعص', 'طه', 'طسم', 'طس', 'يس', 'ص', 'حم', 'عسق', 'ق', 'ن', 'حم عسق']);

  function ayahTokens(displayText) {
    const w = words(displayText);
    if (w.length <= 2 && MUQATTAAT.has(w.join(' '))) {
      const letterSeq = [];
      for (const word of w) for (const ch of word) if (LETTER_NAMES[ch]) letterSeq.push(LETTER_NAMES[ch]);
      return { words: letterSeq, whole: w.join(''), muqattaat: true };
    }
    return { words: w, muqattaat: false };
  }

  const BISMILLAH = ['بسم', 'الله', 'الرحمن', 'الرحيم'];

  // ---------- جلسة تسميع ----------
  function Session(verses, startAyah, opts) {
    opts = opts || {};
    this.tokens = verses.map(ayahTokens);
    this.ayah = startAyah || 0;
    this.wi = 0;
    this.bismillahDone = !(this.ayah === 0 && !opts.noBismillah);
    this.bi = 0;
    this.pendingWord = null;
    this.completedInCall = [];
  }

  Session.prototype.clone = function () {
    const c = Object.create(Session.prototype);
    c.tokens = this.tokens;
    c.ayah = this.ayah; c.wi = this.wi;
    c.bismillahDone = this.bismillahDone; c.bi = this.bi;
    c.pendingWord = this.pendingWord; c.completedInCall = [];
    return c;
  };

  Session.prototype.currentWords = function () {
    return this.tokens[this.ayah] ? this.tokens[this.ayah].words : [];
  };
  Session.prototype.progress = function () {
    const t = this.tokens[this.ayah];
    return { ayah: this.ayah, wordIndex: this.wi, totalWords: t ? t.words.length : 0, done: this.ayah >= this.tokens.length };
  };
  Session.prototype.skipAyah = function () {
    this.completedInCall = [];
    this._completeAyah(true);
    return this.completedInCall;
  };
  Session.prototype._completeAyah = function (skipped) {
    this.completedInCall.push({ index: this.ayah, skipped: !!skipped });
    this.ayah++; this.wi = 0; this.pendingWord = null;
  };

  Session.prototype.feed = function (spokenText) {
    this.completedInCall = [];
    const spoken = words(spokenText);
    for (const s of spoken) this._feedWord(s);
    return this.completedInCall;
  };

  Session.prototype._feedWord = function (s) {
    if (this.ayah >= this.tokens.length) return;

    // البسملة الاختيارية قبل أول آية
    if (!this.bismillahDone) {
      if (this.bi < BISMILLAH.length && wordMatch(s, BISMILLAH[this.bi])) {
        this.bi++;
        if (this.bi === BISMILLAH.length) this.bismillahDone = true;
        return;
      }
      this.bismillahDone = true; // بدأ بغير البسملة — تابع المطابقة
    }

    const tok = this.tokens[this.ayah];
    const w = tok.words;

    // الحروف المقطعة: اقبل الكلمة كاملة دفعة واحدة (مثل "طه")
    if (tok.muqattaat && this.wi === 0 && wordMatch(s, normalize(tok.whole))) {
      this.wi = w.length; this.pendingWord = null; this._maybeComplete(); return;
    }

    const exp = w[this.wi];

    // 1) تطابق مباشر
    if (wordMatch(s, exp)) { this.wi++; this.pendingWord = null; this._maybeComplete(); return; }

    // 2) دمج: كلمة سابقة غير مطابقة + الحالية = المتوقعة
    if (this.pendingWord && wordMatch(this.pendingWord + s, exp)) { this.wi++; this.pendingWord = null; this._maybeComplete(); return; }

    // 3) الكلمة المنطوقة = كلمتان متوقعتان مدمجتان
    if (this.wi + 1 < w.length && wordMatch(s, exp + w[this.wi + 1])) { this.wi += 2; this.pendingWord = null; this._maybeComplete(); return; }

    // 4) تخطي كلمة متوقعة واحدة أو اثنتين (سقطت من التعرف الصوتي)
    if (this.wi + 1 < w.length && s.length >= 3 && wordMatch(s, w[this.wi + 1])) { this.wi += 2; this.pendingWord = null; this._maybeComplete(); return; }
    if (this.wi + 2 < w.length && s.length >= 4 && wordMatch(s, w[this.wi + 2])) { this.wi += 3; this.pendingWord = null; this._maybeComplete(); return; }

    // 5) إعادة تزامن ثنائية: كلمتان منطوقتان متتاليتان تطابقان موضعاً قادماً
    if (this.pendingWord) {
      for (let k = 0; k <= 4 && this.wi + k + 1 < w.length; k++) {
        if (wordMatch(this.pendingWord, w[this.wi + k]) && wordMatch(s, w[this.wi + k + 1])) {
          this.wi += k + 2; this.pendingWord = null; this._maybeComplete(); return;
        }
      }
    }

    // 6) اقتراب نهاية الآية: المتبقي كلمة أو كلمتان وبدأ الآية التالية
    if (w.length - this.wi <= 2 && this.ayah + 1 < this.tokens.length) {
      const nx = this.tokens[this.ayah + 1];
      if (!nx.muqattaat && nx.words.length) {
        if (s.length >= 3 && wordMatch(s, nx.words[0])) {
          this._completeAyah(false);
          this.wi = 1; this.pendingWord = null; this._maybeComplete(); return;
        }
        if (this.pendingWord && nx.words.length > 1 && wordMatch(this.pendingWord, nx.words[0]) && wordMatch(s, nx.words[1])) {
          this._completeAyah(false);
          this.wi = 2; this.pendingWord = null; this._maybeComplete(); return;
        }
      }
    }

    this.pendingWord = s;
  };

  Session.prototype._maybeComplete = function () {
    const tok = this.tokens[this.ayah];
    if (tok && this.wi >= tok.words.length) this._completeAyah(false);
  };

  return { normalize, words, lev, wordMatch, ayahTokens, Session, BISMILLAH };
});
