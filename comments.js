(() => {
  const endpoint = "https://jxjxqfrtvdpvrifktxsf.supabase.co/functions/v1/comments";
  const publicApiKey = "sb_publishable_ODGjHx6gmasNpY9b4kKVzQ_qIL6gq64";
  const noteTipUrl = "https://note.com/dear_bonobo1836/n/n6ba3e3177429";
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

  if (!privacy || !form || !nicknameInput || !commentInput || !list || !sentinel) return;

  let cursor = null;
  let hasMore = true;
  let loadingPage = false;
  let hasLoadedOnce = false;
  const renderedIds = new Set();

  function makeTextElement(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    element.textContent = text;
    return element;
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
    meta.append(makeTextElement("span", "comment-author", comment.nickname || "匿名"));

    const time = document.createElement("time");
    time.className = "comment-time";
    const createdAt = new Date(comment.createdAt);
    if (!Number.isNaN(createdAt.getTime())) {
      time.dateTime = createdAt.toISOString();
      time.textContent = new Intl.DateTimeFormat("ja-JP", {
        year: "numeric", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(createdAt);
    }
    meta.append(time);

    const body = makeTextElement("p", "comment-text", comment.body || "");
    const reply = document.createElement("div");
    reply.className = "reply";
    reply.append(
      makeTextElement("div", "reply-label", comment.reply?.author || "AIタカシ"),
      makeTextElement("p", "reply-text", comment.reply?.body || ""),
    );

    if (comment.tipRequested === true) {
      const tipLink = document.createElement("a");
      tipLink.className = "tip-link";
      tipLink.href = noteTipUrl;
      tipLink.target = "_blank";
      tipLink.rel = "noopener noreferrer";
      tipLink.textContent = "noteでチップを送る";
      reply.append(tipLink);
    }

    card.append(meta, body, reply);
    return card;
  }

  function updateCharacterCount() {
    characterCount.textContent = `${Array.from(commentInput.value).length}/280`;
  }

  function setFormStatus(message, isError = false) {
    formStatus.textContent = message;
    formStatus.classList.toggle("is-error", isError);
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
    const rawBody = commentInput.value.trim();
    if (!rawBody || Array.from(rawBody).length > 280) {
      setFormStatus("コメントは1〜280文字で入力してください。", true);
      return;
    }
    const body = privacy.normalizeComment(rawBody);
    if (!body) {
      setFormStatus("コメントは1〜280文字で入力してください。", true);
      return;
    }
    const nickname = privacy.normalizeNickname(nicknameInput.value);

    postButton.disabled = true;
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
      setFormStatus("コメントを投稿しました。");
    } catch {
      setFormStatus("コメントを投稿できませんでした。時間をおいてもう一度お試しください。", true);
    } finally {
      postButton.disabled = false;
    }
  }

  commentInput.addEventListener("input", updateCharacterCount);
  form.addEventListener("submit", submitComment);
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
