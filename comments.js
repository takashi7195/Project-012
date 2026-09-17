(() => {
  const endpoint = "https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/comments";
  const publicApiKey = "sb_publishable_ODGjHx6gmasNpY9b4kKVzQ_qIL6gq64";
  const ofuseTipUrl = "https://ofuse.me/7de5342a";
  const aiAvatarUrl = "ai-takashi-avatar.png";
  const privacy = globalThis.ProjectCommentSafety;
  const form = document.getElementById("comment-form");
  const nicknameInput = document.getElementById("nickname");
  const commentInput = document.getElementById("comment");
  const characterCount = document.getElementById("comment-count");
  const formStatus = document.getElementById("comment-status");
  const postButton = document.getElementById("post-button");
  const list = document.getElementById("comments-list");
  const loading = document.getElementById("comments-loading");
  const loadStatus = document.getElementById("comments-load-status");
  const retryButton = document.getElementById("comments-retry");
  const sentinel = document.getElementById("comments-sentinel");
  const openButton = document.getElementById("comment-open");
  const closeButton = document.getElementById("comment-close");
  const composer = document.getElementById("comment-composer");
  const siteContent = document.getElementById("site-content");
  const notice = document.getElementById("comment-notice");
  const avatarDialog = document.getElementById("avatar-dialog");
  const avatarDialogClose = document.getElementById("avatar-dialog-close");

  if (!privacy || !form || !nicknameInput || !commentInput || !list || !sentinel || !openButton || !closeButton || !composer || !siteContent || !avatarDialog || !avatarDialogClose) return;

  let cursor = null;
  let hasMore = true;
  let loadingPage = false;
  let hasLoadedOnce = false;
  const renderedIds = new Set();
  let savedScrollY = 0;
  let composerOpen = false;
  let submitting = false;

  function formatCommentTime(date) {
    const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60000));
    if (minutes < 1) return "たった今";
    if (minutes < 60) return `${minutes}分前`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}時間前`;
    if (minutes < 10080) return `${Math.floor(minutes / 1440)}日前`;
    return new Intl.DateTimeFormat("ja-JP", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  }

  function makeTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function avatarInitial(nickname) {
    const value = typeof nickname === "string" ? nickname.trim() : "";
    return value && value !== "匿名" ? Array.from(value)[0] : "匿";
  }

  function avatarColor(nickname) {
    const palette = ["#7b58c9", "#e84f8a", "#3f9d70", "#d58b36", "#3f83b8", "#8b6a58"];
    const value = typeof nickname === "string" ? nickname.trim() : "";
    if (!value || value === "匿名") return "#7c8795";
    let hash = 0;
    for (const character of value) hash = (hash * 31 + character.codePointAt(0)) >>> 0;
    return palette[hash % palette.length];
  }

  function makeUserAvatar(nickname) {
    const avatar = makeTextElement("span", "user-avatar", avatarInitial(nickname));
    avatar.style.setProperty("--avatar-color", avatarColor(nickname));
    avatar.setAttribute("aria-hidden", "true");
    return avatar;
  }

  function makeCard(comment) {
    const card = document.createElement("article");
    card.className = "comment-card";
    if (typeof comment.id === "string") {
      card.dataset.commentId = comment.id;
      renderedIds.add(comment.id);
    }

    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const nickname = comment.nickname || "匿名";
    const metaContent = document.createElement("div");
    metaContent.className = "comment-meta-content";
    const authorLine = document.createElement("div");
    authorLine.className = "comment-author-line";
    authorLine.append(makeTextElement("span", "comment-author", nickname));

    const time = document.createElement("time");
    time.className = "comment-time";
    const createdAt = new Date(comment.createdAt);
    if (!Number.isNaN(createdAt.getTime())) {
      time.dateTime = createdAt.toISOString();
      time.title = new Intl.DateTimeFormat("ja-JP", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(createdAt);
      time.textContent = formatCommentTime(createdAt);
    }
    authorLine.append(time);
    const body = makeTextElement("p", "comment-text", comment.body || "");
    metaContent.append(authorLine, body);
    meta.append(makeUserAvatar(nickname), metaContent);
    const reply = document.createElement("div");
    reply.className = "reply";
    const replyAvatarButton = document.createElement("button");
    replyAvatarButton.className = "reply-avatar-button";
    replyAvatarButton.type = "button";
    replyAvatarButton.setAttribute("aria-label", "AIタカシの画像を拡大表示");
    const replyAvatar = document.createElement("img");
    replyAvatar.className = "reply-avatar";
    replyAvatar.src = aiAvatarUrl;
    replyAvatar.alt = "";
    replyAvatar.width = 40;
    replyAvatar.height = 40;
    replyAvatarButton.append(replyAvatar);
    const replyContent = document.createElement("div");
    replyContent.className = "reply-content";
    replyContent.append(
      makeTextElement("div", "reply-label", comment.reply?.author || "AIタカシ"),
      makeTextElement("p", "reply-text", comment.reply?.body || ""),
    );
    reply.append(replyAvatarButton, replyContent);

    if (comment.tipRequested === true) {
      const tipLink = document.createElement("a");
      tipLink.className = "tip-link";
      tipLink.href = ofuseTipUrl;
      tipLink.target = "_blank";
      tipLink.rel = "noopener noreferrer";
      tipLink.textContent = "🍺 タカシに生ビールをおごる";
      replyContent.append(tipLink);
    }

    card.append(meta, reply);
    return card;
  }

  function updateCharacterCount() {
    characterCount.textContent = `${Array.from(commentInput.value).length}/300`;
  }

  function setFormStatus(message, isError = false) {
    formStatus.textContent = message;
    formStatus.classList.toggle("is-error", isError);
  }

  function setAvatarDialogOpen(isOpen) {
    avatarDialog.hidden = !isOpen;
    document.body.classList.toggle("avatar-dialog-open", isOpen);
    if (isOpen) avatarDialogClose.focus({ preventScroll: true });
  }

  function setComposerOpen(isOpen) {
    if (submitting || composerOpen === isOpen) return;
    composerOpen = isOpen;
    openButton.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) {
      savedScrollY = window.scrollY;
      composer.hidden = false;
      siteContent.inert = true;
      document.body.classList.add("comment-composer-open");
      Object.assign(document.body.style, { position: "fixed", top: `-${savedScrollY}px`, width: "100%" });
      setFormStatus("");
      updateKeyboardOffset();
      // Synchronous focus inside the tap handler opens the iOS keyboard.
      commentInput.focus({ preventScroll: true });
    } else {
      document.activeElement?.blur();
      composer.hidden = true;
      siteContent.inert = false;
      document.body.classList.remove("comment-composer-open");
      Object.assign(document.body.style, { position: "", top: "", width: "" });
      window.scrollTo(0, savedScrollY);
      openButton.focus({ preventScroll: true });
    }
  }

  function updateKeyboardOffset() {
    const viewport = window.visualViewport;
    composer.style.setProperty("--composer-top", `${viewport?.offsetTop || 0}px`);
    composer.style.setProperty("--composer-height", `${viewport?.height || window.innerHeight}px`);
  }

  function sizeCommentInput() {
    commentInput.style.height = "76px";
    commentInput.style.height = `${Math.min(150, Math.max(76, commentInput.scrollHeight))}px`;
  }

  async function loadNextPage() {
    if (loadingPage || !hasMore) return;
    loadingPage = true;
    loading.hidden = false;
    retryButton.hidden = true;

    try {
      const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
      const response = await fetch(`${endpoint}${query}`, {
        headers: { Accept: "application/json", apikey: publicApiKey },
      });
      if (!response.ok) throw new Error("load failed");
      const result = await response.json();
      if (!Array.isArray(result.comments)) throw new Error("invalid response");

      const fragment = document.createDocumentFragment();
      result.comments.forEach((comment) => {
        if (!comment || typeof comment.id !== "string" || renderedIds.has(comment.id)) return;
        fragment.append(makeCard(comment));
      });
      list.append(fragment);
      cursor = typeof result.nextCursor === "string" ? result.nextCursor : null;
      hasMore = Boolean(cursor);
      hasLoadedOnce = true;
      loadStatus.textContent = "";

      if (!list.childElementCount && !hasMore) {
        list.append(makeTextElement("p", "comments-empty", "まだコメントはありません。"));
      }
    } catch {
      loadStatus.textContent = "コメントを読み込めませんでした。時間をおいて再読み込みしてください。";
      retryButton.hidden = false;
    } finally {
      loading.hidden = true;
      loadingPage = false;
      if (!hasLoadedOnce) retryButton.hidden = false;
    }
  }

  async function submitComment(event) {
    event.preventDefault();
    if (submitting) return;
    const rawBody = commentInput.value.trim();
    if (!rawBody || Array.from(rawBody).length > 300) {
      setFormStatus("コメントは1〜300文字で入力してください。", true);
      return;
    }
    const body = privacy.normalizeComment(rawBody);
    if (!body) {
      setFormStatus("コメントは1〜300文字で入力してください。", true);
      return;
    }
    const nickname = privacy.normalizeNickname(nicknameInput.value);

    submitting = true;
    postButton.disabled = true;
    closeButton.disabled = true;
    nicknameInput.readOnly = true;
    commentInput.readOnly = true;
    form.setAttribute("aria-busy", "true");
    setFormStatus("");
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", apikey: publicApiKey },
        body: JSON.stringify({ nickname, body }),
      });
      if (!response.ok) throw new Error("post failed");
      const result = await response.json();
      if (!result.comment || typeof result.comment.body !== "string") throw new Error("invalid response");

      list.querySelector(".comments-empty")?.remove();
      list.prepend(makeCard(result.comment));
      form.reset();
      updateCharacterCount();
      sizeCommentInput();
      submitting = false;
      setComposerOpen(false);
      notice.textContent = "コメントを投稿しました。";
      list.firstElementChild?.scrollIntoView({ block: "nearest", behavior: "instant" });
    } catch {
      setFormStatus("コメントを投稿できませんでした。時間をおいてもう一度お試しください。", true);
    } finally {
      submitting = false;
      postButton.disabled = false;
      closeButton.disabled = false;
      nicknameInput.readOnly = false;
      commentInput.readOnly = false;
      form.removeAttribute("aria-busy");
    }
  }

  commentInput.addEventListener("input", () => { updateCharacterCount(); sizeCommentInput(); });
  form.addEventListener("submit", submitComment);
  openButton.addEventListener("click", () => setComposerOpen(true));
  closeButton.addEventListener("click", () => setComposerOpen(false));
  list.addEventListener("click", (event) => {
    if (event.target.closest(".reply-avatar-button")) setAvatarDialogOpen(true);
  });
  avatarDialogClose.addEventListener("click", () => setAvatarDialogOpen(false));
  avatarDialog.querySelector("[data-avatar-close]").addEventListener("click", () => setAvatarDialogOpen(false));
  avatarDialog.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); setAvatarDialogOpen(false); }
  });
  composer.querySelector(".composer-backdrop").addEventListener("click", () => setComposerOpen(false));
  composer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); setComposerOpen(false); }
    if (event.key !== "Tab") return;
    const focusable = [...composer.querySelectorAll('button:not(:disabled), input, textarea, a[href]')];
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", updateKeyboardOffset);
    window.visualViewport.addEventListener("scroll", updateKeyboardOffset);
  }
  window.addEventListener("resize", updateKeyboardOffset);
  updateKeyboardOffset();
  retryButton.addEventListener("click", () => {
    loadStatus.textContent = "";
    loadNextPage();
  });

  if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) loadNextPage();
    }, { rootMargin: "240px 0px" });
    observer.observe(sentinel);
  } else {
    window.addEventListener("scroll", () => {
      if (sentinel.getBoundingClientRect().top < window.innerHeight + 240) loadNextPage();
    }, { passive: true });
  }

  updateCharacterCount();
  loadNextPage();
})();
