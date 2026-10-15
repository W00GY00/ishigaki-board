
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://ypfrvhvzepfbltyealge.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_7yx2B9ndSvH_jjMxc7U5iQ_ckuY2bLX";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = (selector) => document.querySelector(selector);

const pages = {
  home: $("#home-page"),
  board: $("#board-page"),
  profile: $("#profile-page"),
};

let currentUser = null;
let currentNickname = "여행자";
let isMember = false;
let isBusy = false;

function setMessage(element, message, isError = false) {
  if (!element) return;
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setBusy(button, busy, busyText = "처리 중...") {
  if (!button) return;

  if (!button.dataset.originalText) {
    button.dataset.originalText = button.textContent;
  }

  button.disabled = busy;
  button.textContent = busy
    ? busyText
    : button.dataset.originalText;
}

function showPage(pageName) {
  if (!pages[pageName]) return;

  if (pageName !== "home" && !isMember) {
    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
    return;
  }

  Object.entries(pages).forEach(([name, element]) => {
    const active = name === pageName;
    element.hidden = !active;
    element.classList.toggle("active", active);
  });

  document.querySelectorAll(".nav-item").forEach((button) => {
    const active = button.dataset.page === pageName;
    button.classList.toggle("active", active);

    if (active) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  if (pageName === "board") loadPosts();
  if (pageName === "profile") loadProfile();

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// 로그인 및 참가 인증 상태 확인
async function initializeApp() {
  try {
    let { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (!data.session) {
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw result.error;
      data = { session: result.data.session };
    }

    currentUser = data.session?.user;

    if (!currentUser) {
      throw new Error("로그인 정보를 확인할 수 없습니다.");
    }

    await checkMembership();
  } catch (error) {
    console.error("초기화 오류:", error);
    setMessage(
      $("#invite-message"),
      "연결 또는 로그인에 실패했어요. Supabase 설정을 확인해 주세요.",
      true
    );

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
  }
}

// 참가 인증 기록 확인
async function checkMembership() {
  const { data, error } = await supabase
    .from("trip_members")
    .select("user_id")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("참가자 확인 오류:", error);
    setMessage(
      $("#invite-message"),
      "참가 여부를 확인할 수 없어요. trip_members 정책을 확인해 주세요.",
      true
    );

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
    return;
  }

  isMember = Boolean(data);

  if (isMember) {
    setMessage($("#profile-status"), "여행 참가 인증 완료");
    setMessage($("#invite-message"), "");

    await loadProfile();
    await loadPosts();

    if ($("#invite-dialog").open) {
      $("#invite-dialog").close();
    }
  } else {
    setMessage($("#profile-status"), "참가 인증이 필요해요.");

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
  }
}

// 여행 참가 코드 검증
$("#invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (isBusy) return;

  const code = $("#invite-code").value.trim();
  const button = $("#invite-submit");

  if (!code) {
    setMessage($("#invite-message"), "참가 코드를 입력해 주세요.", true);
    return;
  }

  isBusy = true;
  setBusy(button, true, "인증 중...");
  setMessage($("#invite-message"), "");

  try {
    if (!currentUser) {
      const result = await supabase.auth.signInAnonymously();
      if (result.error) throw result.error;
      currentUser = result.data.user;
    }

    const { data, error } = await supabase.functions.invoke(
      "verify-trip-code",
      { body: { code } }
    );

    if (error) {
      console.error("참가 인증 요청 실패:", error);
    
      let serverMessage = "";
    
      try {
        const response = error.context;
    
        if (response && typeof response.json === "function") {
          const details = await response.json();
          serverMessage = details?.error || "";
        }
      } catch (readError) {
        console.error("서버 오류 내용 확인 실패:", readError);
  }

  throw new Error(
    serverMessage ||
    "인증 요청에 실패했어요. 브라우저 개발자 도구에서 자세한 오류를 확인해 주세요."
  );
}

    if (!data?.success) {
      throw new Error(data?.error || "참가 인증에 실패했어요.");
    }

    $("#invite-code").value = "";
    setMessage($("#invite-message"), "인증 성공! 참가 정보를 확인하고 있어요.");

    await checkMembership();

    if (isMember) {
      showPage("home");
    }
  } catch (error) {
    console.error("참가 인증 오류:", error);
    setMessage(
      $("#invite-message"),
      error.message || "인증 중 오류가 발생했어요.",
      true
    );
  } finally {
    isBusy = false;
    setBusy(button, false);
  }
});

// 닉네임 조회: profiles의 기본 키는 id
async function loadProfile() {
  if (!currentUser || !isMember) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, nickname")
    .eq("id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("프로필 조회 오류:", error);
    return;
  }

  currentNickname = data?.nickname || "여행자";
  $("#nickname").value = data?.nickname || "";
  $("#profile-display-name").textContent = currentNickname;
}

// 닉네임 저장
$("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !isMember) return;

  const nickname = $("#nickname").value.trim();
  const button = event.currentTarget.querySelector("button[type='submit']");

  if (!nickname || nickname.length > 30) {
    setMessage($("#profile-status"), "닉네임은 1~30자로 입력해 주세요.", true);
    return;
  }

  setBusy(button, true, "저장 중...");

  try {
    const { error } = await supabase
      .from("profiles")
      .upsert(
        {
          id: currentUser.id,
          nickname,
        },
        { onConflict: "id" }
      );

    if (error) throw error;

    currentNickname = nickname;
    $("#profile-display-name").textContent = nickname;
    setMessage($("#profile-status"), "닉네임을 저장했어요.");
  } catch (error) {
    console.error("닉네임 저장 오류:", error);
    setMessage(
      $("#profile-status"),
      "저장에 실패했어요. profiles 테이블과 RLS 정책을 확인해 주세요.",
      true
    );
  } finally {
    setBusy(button, false);
  }
});

// 게시글 조회: posts의 실제 열 이름 사용
async function loadPosts() {
  if (!isMember) return;

  const list = $("#posts-list");
  if (!list) return;

  $("#post-count").textContent = "불러오는 중...";
  list.replaceChildren();

  try {
    const { data, error } = await supabase
      .from("posts")
      .select("id, author_id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    $("#post-count").textContent = `게시글 ${data.length}개`;

    if (data.length === 0) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "아직 게시글이 없어요. 첫 여행 기록을 남겨 보세요!";
      list.append(empty);
      return;
    }

    data.forEach((post) => {
      const card = document.createElement("article");
      card.className = "post-card";

      const meta = document.createElement("div");
      meta.className = "post-meta";

      const author = document.createElement("span");
      author.className = "post-author";
      author.textContent =
        post.author_id === currentUser?.id
          ? currentNickname
          : "여행자";

      const date = document.createElement("time");
      date.dateTime = post.created_at;
      date.textContent = new Date(post.created_at).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const title = document.createElement("h3");
      title.className = "post-title";
      title.textContent = post.title || "여행 기록";

      const body = document.createElement("p");
      body.className = "post-content";
      body.textContent = post.body || "";

      meta.append(author, date);
      card.append(meta, title, body);

      if (post.author_id === currentUser?.id) {
        const removeButton = document.createElement("button");
        removeButton.type = "button";
        removeButton.className = "secondary-button";
        removeButton.textContent = "내 게시글 삭제";
        removeButton.style.marginTop = "15px";
        removeButton.addEventListener("click", () => deletePost(post.id));
        card.append(removeButton);
      }

      list.append(card);
    });
  } catch (error) {
    console.error("게시글 조회 오류:", error);
    $("#post-count").textContent = "조회 실패";

    const message = document.createElement("div");
    message.className = "empty-state";
    message.textContent =
      "게시글을 불러오지 못했어요. posts 테이블과 RLS 정책을 확인해 주세요.";
    list.append(message);
  }
}

// 게시글 등록
$("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!currentUser || !isMember) return;

  const body = $("#post-content").value.trim();
  const titleInput = $("#post-title");
  const enteredTitle = titleInput?.value.trim() || "";

  const title =
    enteredTitle ||
    body.split(/\r?\n/)[0].slice(0, 60) ||
    "여행 기록";

  const button = event.currentTarget.querySelector("button[type='submit']");

  if (!body) {
    setMessage($("#board-message"), "게시글 내용을 입력해 주세요.", true);
    return;
  }

  setBusy(button, true, "등록 중...");
  setMessage($("#board-message"), "");

  try {
    const { error } = await supabase.from("posts").insert({
      author_id: currentUser.id,
      title,
      body,
    });

    if (error) throw error;

    $("#post-content").value = "";
    if (titleInput) titleInput.value = "";

    setMessage($("#board-message"), "게시글을 등록했어요.");
    await loadPosts();
  } catch (error) {
    console.error("게시글 등록 오류:", error);
    setMessage(
      $("#board-message"),
      "게시글 등록에 실패했어요. posts 테이블과 RLS 정책을 확인해 주세요.",
      true
    );
  } finally {
    setBusy(button, false);
  }
});

// 본인이 작성한 게시글 삭제
async function deletePost(postId) {
  if (!currentUser || !isMember) return;
  if (!window.confirm("이 게시글을 삭제할까요?")) return;

  try {
    const { error } = await supabase
      .from("posts")
      .delete()
      .eq("id", postId)
      .eq("author_id", currentUser.id);

    if (error) throw error;

    setMessage($("#board-message"), "게시글을 삭제했어요.");
    await loadPosts();
  } catch (error) {
    console.error("게시글 삭제 오류:", error);
    setMessage($("#board-message"), "게시글 삭제에 실패했어요.", true);
  }
}

// 하단 메뉴와 홈 버튼
document.querySelectorAll("[data-page]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.page));
});

document.querySelectorAll("[data-go]").forEach((button) => {
  button.addEventListener("click", () => showPage(button.dataset.go));
});

$("#refresh-posts").addEventListener("click", loadPosts);

// 배경음악
$("#music-toggle").addEventListener("click", async () => {
  const audio = $("#bgm");
  const button = $("#music-toggle");

  if (audio.paused) {
    try {
      await audio.play();
      button.setAttribute("aria-pressed", "true");
      $("#music-label").textContent = "MUSIC ON";
    } catch (error) {
      console.error("음악 재생 실패:", error);
      $("#music-label").textContent = "FILE CHECK";
      alert("음악 파일을 확인해 주세요: files/ishigaki-bgm.mp3");
    }
  } else {
    audio.pause();
    button.setAttribute("aria-pressed", "false");
    $("#music-label").textContent = "MUSIC OFF";
  }
});

// 앱 시작
initializeApp();
