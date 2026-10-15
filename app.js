
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Supabase 대시보드의 Project URL과 Publishable key(또는 anon public key)
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
  element.textContent = message;
  element.classList.toggle("error", isError);
}

function setBusy(button, busy, busyText = "처리 중...") {
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
    $("#invite-dialog").showModal();
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

// Supabase 연결 상태와 익명 로그인 확인
async function initializeApp() {
  if (
    SUPABASE_URL === "YOUR_SUPABASE_URL" ||
    SUPABASE_ANON_KEY === "YOUR_SUPABASE_ANON_KEY"
  ) {
    setMessage(
      $("#invite-message"),
      "app.js에 Supabase 프로젝트 URL과 공개 키를 먼저 입력해 주세요.",
      true
    );
    $("#invite-dialog").showModal();
    return;
  }

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

// 서버에서 참가 인증을 완료한 사용자만 멤버로 인정
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
      "참가 여부를 확인할 수 없어요. 데이터베이스 정책을 확인해 주세요.",
      true
    );

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
    return;
  }

  isMember = Boolean(data);

  if (isMember) {
    $("#profile-status").textContent = "여행 참가 인증 완료";
    $("#invite-message").textContent = "";
    await loadProfile();
    await loadPosts();

    if ($("#invite-dialog").open) {
      $("#invite-dialog").close();
    }
  } else {
    $("#profile-status").textContent = "참가 인증이 필요해요.";

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
  }
}

// 여행 참가 코드 검증
$("#invite-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isBusy) return;

  const code = $("#invite-code").value;
  const button = $("#invite-submit");

  if (!code.trim()) {
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

    // Supabase SDK가 현재 로그인 세션을 이용해 인증 헤더를 처리
    const { data, error } = await supabase.functions.invoke(
      "verify-trip-code",
      {
        body: { code },
      }
    );

    if (error) {
      console.error("참가 인증 요청 실패:", error);
      throw new Error("인증 요청에 실패했어요. 로그인과 함수 설정을 확인해 주세요.");
    }

    if (!data?.success) {
      throw new Error(data?.error || "참가 인증에 실패했어요.");
    }

    $("#invite-code").value = "";
    setMessage($("#invite-message"), "인증 성공! 여행 공간에 입장합니다.");

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

// 닉네임 조회
async function loadProfile() {
  if (!currentUser || !isMember) return;

  const { data, error } = await supabase
    .from("profiles")
    .select("nickname")
    .eq("user_id", currentUser.id)
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
          user_id: currentUser.id,
          nickname,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id" }
      );

    if (error) throw error;

    currentNickname = nickname;
    $("#profile-display-name").textContent = nickname;
    setMessage($("#profile-status"), "닉네임을 저장했어요.");
  } catch (error) {
    console.error("닉네임 저장 오류:", error);
    setMessage(
      $("#profile-status"),
      "저장에 실패했어요. profiles 테이블과 보안 정책을 확인해 주세요.",
      true
    );
  } finally {
    setBusy(button, false);
  }
});

// 게시글 조회
async function loadPosts() {
  if (!isMember) return;

  const list = $("#posts-list");
  $("#post-count").textContent = "불러오는 중...";
  list.replaceChildren();

  try {
    const { data, error } = await supabase
      .from("posts")
      .select("id, user_id, nickname, content, created_at")
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
      author.textContent = post.nickname || "여행자";

      const date = document.createElement("time");
      date.dateTime = post.created_at;
      date.textContent = new Date(post.created_at).toLocaleString("ko-KR", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });

      const content = document.createElement("p");
      content.className = "post-content";
      content.textContent = post.content;

      meta.append(author, date);
      card.append(meta, content);

      if (post.user_id === currentUser?.id) {
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

  const content = $("#post-content").value.trim();
  const button = event.currentTarget.querySelector("button[type='submit']");

  if (!content) {
    setMessage($("#board-message"), "게시글 내용을 입력해 주세요.", true);
    return;
  }

  setBusy(button, true, "등록 중...");
  setMessage($("#board-message"), "");

  try {
    const { error } = await supabase.from("posts").insert({
      user_id: currentUser.id,
      nickname: currentNickname,
      content,
    });

    if (error) throw error;

    $("#post-content").value = "";
    setMessage($("#board-message"), "게시글을 등록했어요.");
    await loadPosts();
  } catch (error) {
    console.error("게시글 등록 오류:", error);
    setMessage(
      $("#board-message"),
      "게시글 등록에 실패했어요. 테이블 열과 RLS 정책을 확인해 주세요.",
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
      .eq("user_id", currentUser.id);

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

// 배경음악: 브라우저 정책에 따라 사용자 클릭 후 재생
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
      alert("음악 파일이 있는지 확인해 주세요: files/ishigaki-bgm.mp3");
    }
  } else {
    audio.pause();
    button.setAttribute("aria-pressed", "false");
    $("#music-label").textContent = "MUSIC OFF";
  }
});

// 앱 시작
initializeApp();
