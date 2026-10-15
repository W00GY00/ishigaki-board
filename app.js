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

const MAX_PHOTOS = 5;
const MAX_PHOTO_SIZE = 8 * 1024 * 1024;
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];

let currentUser = null;
let currentNickname = "여행자";
let isMember = false;
let isBusy = false;
let isAdmin = false;

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
  button.textContent = busy ? busyText : button.dataset.originalText;
}

function showPage(pageName) {
  if (!pages[pageName]) return;

  if (pageName !== "home" && !isMember && !isAdmin) {
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

function formatDate(value) {
  return new Date(value).toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
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

/* 관리자 계정 확인 */
async function checkAdmin() {
  isAdmin = false;

  if (!currentUser?.id) return;

  const { data, error } = await supabase
    .from("trip_admins")
    .select("user_id")
    .eq("user_id", currentUser.id)
    .maybeSingle();

  if (error) {
    console.error("관리자 확인 오류:", error);
    return;
  }

  isAdmin = Boolean(data);
  console.log("관리자 여부:", isAdmin);
}

// 참가 인증 기록 확인

 // 참가 인증 기록 확인

async function checkMembership() {
  // 관리자 여부를 먼저 확인해 참가자 인증과 분리
  await checkAdmin();

  if (isAdmin) {
    setMessage($("#profile-status"), "관리자 로그인 완료");
    setMessage($("#invite-message"), "");
    $("#logout-button").hidden = false;

    if ($("#invite-dialog").open) {
      $("#invite-dialog").close();
    }

    await loadPosts();
    return;
  }

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
    $("#logout-button").hidden = true;

    await loadProfile();
    await loadPosts();

    if ($("#invite-dialog").open) {
      $("#invite-dialog").close();
    }
  } else {
    setMessage($("#profile-status"), "참가 인증이 필요해요.");
    $("#logout-button").hidden = true;

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
        serverMessage || "인증 요청에 실패했어요. Edge Function 설정을 확인해 주세요."
      );
    }

    if (!data?.success) {
      throw new Error(data?.error || "참가 인증에 실패했어요.");
    }

    $("#invite-code").value = "";
    setMessage($("#invite-message"), "인증 성공! 참가 정보를 확인하고 있어요.");

    await checkMembership();

    if (isMember) showPage("home");
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

/* 관리자 이메일/비밀번호 로그인 */
$("#admin-login-form").addEventListener("submit", async (event) => {
  event.preventDefault();

  const email = $("#admin-email").value.trim();
  const password = $("#admin-password").value;
  const button = $("#admin-login-submit");

  setBusy(button, true, "로그인 중...");
  setMessage($("#admin-login-message"), "");

  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;

    currentUser = data.user;
    isMember = false;

    await checkAdmin();

    if (!isAdmin) {
      await supabase.auth.signOut();

      const { data: anonymousData, error: anonymousError } =
        await supabase.auth.signInAnonymously();

      if (anonymousError) throw anonymousError;

      currentUser = anonymousData.user;
      isAdmin = false;

      throw new Error(
        "이 계정에는 관리자 권한이 없어요. 관리자 계정을 확인해 주세요."
      );
    }

    $("#admin-password").value = "";
    $("#logout-button").hidden = false;

    setMessage($("#profile-status"), "관리자 로그인 완료");
    setMessage($("#admin-login-message"), "관리자 로그인에 성공했어요.");

    if ($("#invite-dialog").open) {
      $("#invite-dialog").close();
    }

    await loadPosts();
    showPage("home");
  } catch (error) {
    console.error("관리자 로그인 오류:", error);

    setMessage(
      $("#admin-login-message"),
      error.message ||
        "로그인에 실패했어요. 이메일과 비밀번호를 확인해 주세요.",
      true
    );
  } finally {
    setBusy(button, false);
  }
});

/* 로그아웃 */
$("#logout-button").addEventListener("click", async () => {
  const button = $("#logout-button");

  if (button.disabled) return;

  setBusy(button, true, "로그아웃 중...");

  try {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;

    currentUser = null;
    isMember = false;
    isAdmin = false;
    currentNickname = "여행자";

    const { data, error: anonymousError } =
      await supabase.auth.signInAnonymously();

    if (anonymousError) throw anonymousError;

    currentUser = data.user;

    setMessage($("#logout-message"), "로그아웃했어요.");
    setMessage($("#admin-login-message"), "");
    setMessage($("#invite-message"), "");

    $("#admin-email").value = "";
    $("#admin-password").value = "";

    await checkMembership();

    if (!$("#invite-dialog").open) {
      $("#invite-dialog").showModal();
    }
  } catch (error) {
    console.error("로그아웃 오류:", error);

    setMessage(
      $("#logout-message"),
      "로그아웃 처리에 실패했어요. 페이지를 새로고침한 뒤 다시 확인해 주세요.",
      true
    );
  } finally {
    setBusy(button, false);
  }
});

// 닉네임 조회
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
        { id: currentUser.id, nickname },
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

// 사진 선택 시 미리보기
$("#post-photos").addEventListener("change", () => {
  const input = $("#post-photos");
  const preview = $("#photo-preview");
  preview.replaceChildren();

  const files = Array.from(input.files || []);

  if (files.length > MAX_PHOTOS) {
    setMessage($("#board-message"), "사진은 한 게시글에 최대 5장까지 첨부할 수 있어요.", true);
    input.value = "";
    return;
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      setMessage(
        $("#board-message"),
        "JPG, PNG, WEBP, GIF 사진만 첨부할 수 있고, 한 장당 8MB 이하여야 해요.",
        true
      );
      input.value = "";
      preview.replaceChildren();
      return;
    }
  }

  setMessage($("#board-message"), "");

  files.forEach((file) => {
    const image = document.createElement("img");
    image.alt = file.name;
    const objectUrl = URL.createObjectURL(file);
    image.src = objectUrl;
    image.addEventListener("load", () => URL.revokeObjectURL(objectUrl), {
      once: true,
    });
    preview.append(image);
  });
});

// 사진을 비공개 Storage에 업로드하고 메타데이터 저장
async function uploadPostPhotos(postId, files) {
  const uploadedPaths = [];

  for (const file of files) {
    const originalExtension = file.name.split(".").pop()?.toLowerCase() || "";
    const safeExtension = /^[a-z0-9]{1,8}$/.test(originalExtension)
      ? originalExtension
      : "jpg";

    // Storage 정책에 맞춰 첫 번째 폴더를 사용자 ID로 설정
    const storagePath =
      `${currentUser.id}/${postId}/${crypto.randomUUID()}.${safeExtension}`;

    const { error: uploadError } = await supabase.storage
      .from("trip-photos")
      .upload(storagePath, file, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) throw uploadError;
    uploadedPaths.push(storagePath);

    const { error: metadataError } = await supabase
      .from("post_photos")
      .insert({
        post_id: postId,
        author_id: currentUser.id,
        storage_path: storagePath,
      });

    if (metadataError) throw metadataError;
  }

  return uploadedPaths;
}

// 게시글에 연결된 사진 URL 생성
async function getPhotosByPost(posts) {
  const result = new Map();
  const postIds = posts.map((post) => post.id);

  if (postIds.length === 0) return result;

  const { data, error } = await supabase
    .from("post_photos")
    .select("id, post_id, storage_path")
    .in("post_id", postIds);

  if (error) {
    console.error("사진 정보 조회 오류:", error);
    return result;
  }

  for (const photo of data || []) {
    const { data: signed, error: signedError } = await supabase.storage
      .from("trip-photos")
      .createSignedUrl(photo.storage_path, 60 * 60);

    if (signedError || !signed?.signedUrl) {
      console.error("사진 URL 생성 오류:", signedError);
      continue;
    }

    if (!result.has(photo.post_id)) result.set(photo.post_id, []);
    result.get(photo.post_id).push(signed.signedUrl);
  }

  return result;
}

// 게시글 작성자의 닉네임 조회
async function getNicknames(posts) {
  const ids = [...new Set(posts.map((post) => post.author_id).filter(Boolean))];
  const result = new Map();

  if (ids.length === 0) return result;

  const { data, error } = await supabase
    .from("profiles")
    .select("id, nickname")
    .in("id", ids);

  if (error) {
    console.error("작성자 닉네임 조회 오류:", error);
    return result;
  }

  for (const profile of data || []) {
    result.set(profile.id, profile.nickname || "여행자");
  }

  return result;
}

// 게시글 카드 생성
function createPostCard(post, photos, nicknames, isHome = false) {
  const card = makeElement(
    "article",
    isHome ? "home-post-card" : "post-card"
  );

  const meta = makeElement("div", "post-meta");
  const author = makeElement(
    "span",
    "post-author",
    nicknames.get(post.author_id) || "여행자"
  );

  const date = document.createElement("time");
  date.dateTime = post.created_at;
  date.textContent = formatDate(post.created_at);

  meta.append(author, date);

  const title = makeElement(
    "h4",
    isHome ? "" : "post-title",
    post.title || "여행 기록"
  );

  const body = makeElement("p", "post-content", post.body || "");
  card.append(meta, title, body);

  if (photos?.length) {
    const photoGrid = makeElement("div", "post-photo-grid");

    photos.forEach((url, index) => {
      const image = document.createElement("img");
      image.src = url;
      image.alt = `${post.title || "여행 기록"} 사진 ${index + 1}`;
      image.loading = "lazy";
      photoGrid.append(image);
    });

    card.append(photoGrid);
  }

  if (isHome) {
    card.addEventListener("click", () => showPage("board"));
  } else if (post.author_id === currentUser?.id || isAdmin) {
    const removeButton = makeElement(
      "button",
      "secondary-button",
      isAdmin ? "게시글 삭제" : "내 게시글 삭제"
    );
    removeButton.type = "button";
    removeButton.style.marginTop = "15px";
    removeButton.addEventListener("click", () => deletePost(post.id));
    card.append(removeButton);
  }

  return card;
}

// 홈과 게시판에 게시글 표시
async function loadPosts() {
  if (!isMember && !isAdmin) return;

  const boardList = $("#posts-list");
  const homeList = $("#home-posts-list");

  $("#post-count").textContent = "불러오는 중...";
  $("#home-post-count").textContent = "불러오는 중...";
  boardList.replaceChildren();
  homeList.replaceChildren();

  try {
    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, author_id, title, body, created_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) throw error;

    const [photosByPost, nicknames] = await Promise.all([
      getPhotosByPost(posts),
      getNicknames(posts),
    ]);

    $("#post-count").textContent = `게시글 ${posts.length}개`;
    $("#home-post-count").textContent = `총 ${posts.length}개의 여행 기록`;

    if (posts.length === 0) {
      boardList.append(
        makeElement(
          "div",
          "empty-state",
          "아직 게시글이 없어요. 첫 여행 기록을 남겨 보세요!"
        )
      );

      homeList.append(
        makeElement(
          "div",
          "empty-state",
          "아직 기록이 없어요. 첫 여행 이야기를 남겨 보세요!"
        )
      );
      return;
    }

    posts.forEach((post) => {
      boardList.append(
        createPostCard(post, photosByPost.get(post.id) || [], nicknames)
      );
    });

    posts.slice(0, 4).forEach((post) => {
      homeList.append(
        createPostCard(post, photosByPost.get(post.id) || [], nicknames, true)
      );
    });
  } catch (error) {
    console.error("게시글 조회 오류:", error);
    $("#post-count").textContent = "조회 실패";
    $("#home-post-count").textContent = "조회 실패";

    boardList.append(
      makeElement(
        "div",
        "empty-state",
        "게시글을 불러오지 못했어요. Supabase 정책을 확인해 주세요."
      )
    );

    homeList.append(
      makeElement(
        "div",
        "empty-state",
        "여행 기록을 불러오지 못했어요."
      )
    );
  }
}

// 게시글 등록 및 사진 업로드
$("#post-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!currentUser || !isMember || isBusy) return;

  const title = $("#post-title").value.trim();
  const body = $("#post-content").value.trim();
  const files = Array.from($("#post-photos").files || []);
  const button = event.currentTarget.querySelector("button[type='submit']");

  if (!title || title.length > 100) {
    setMessage($("#board-message"), "제목을 1~100자로 입력해 주세요.", true);
    return;
  }

  if (!body || body.length > 3000) {
    setMessage($("#board-message"), "내용을 입력해 주세요. 최대 3,000자예요.", true);
    return;
  }

  if (files.length > MAX_PHOTOS) {
    setMessage($("#board-message"), "사진은 최대 5장까지 첨부할 수 있어요.", true);
    return;
  }

  for (const file of files) {
    if (!ALLOWED_TYPES.includes(file.type) || file.size > MAX_PHOTO_SIZE) {
      setMessage(
        $("#board-message"),
        "JPG, PNG, WEBP, GIF 사진만 가능하며 한 장당 8MB 이하여야 해요.",
        true
      );
      return;
    }
  }

  isBusy = true;
  setBusy(button, true, "등록 중...");
  setMessage($("#board-message"), "");

  let postId = null;
  const uploadedPaths = [];

  try {
    const { data: post, error: postError } = await supabase
      .from("posts")
      .insert({
        author_id: currentUser.id,
        title,
        body,
      })
      .select("id")
      .single();

    if (postError) throw postError;
    postId = post.id;

    if (files.length > 0) {
      const paths = await uploadPostPhotos(postId, files);
      uploadedPaths.push(...paths);
    }

    $("#post-title").value = "";
    $("#post-content").value = "";
    $("#post-photos").value = "";
    $("#photo-preview").replaceChildren();

    setMessage($("#board-message"), "게시글과 사진을 등록했어요.");
    await loadPosts();
  } catch (error) {
    console.error("게시글 등록 오류:", error);

    // 업로드 도중 실패하면 만들어진 파일과 게시글을 정리
    if (uploadedPaths.length > 0) {
      const { error: cleanupError } = await supabase.storage
        .from("trip-photos")
        .remove(uploadedPaths);

      if (cleanupError) {
        console.error("업로드 파일 정리 오류:", cleanupError);
      }
    }

    if (postId) {
      await supabase
        .from("post_photos")
        .delete()
        .eq("post_id", postId)
        .eq("author_id", currentUser.id);

      await supabase
        .from("posts")
        .delete()
        .eq("id", postId)
        .eq("author_id", currentUser.id);
    }

    setMessage(
      $("#board-message"),
      "등록에 실패했어요. 연결 상태와 Storage/RLS 정책을 확인해 주세요.",
      true
    );
  } finally {
    isBusy = false;
    setBusy(button, false);
  }
});

// 본인이 작성한 게시글과 사진 삭제

/* 게시글 및 첨부 사진 삭제 */
async function deletePost(postId) {
  if (!currentUser || (!isMember && !isAdmin)) return;

  if (!window.confirm("이 게시글과 첨부 사진을 삭제할까요?")) {
    return;
  }

  try {
    // 관리자는 해당 게시글의 모든 사진을 조회하고,
    // 일반 참가자는 본인이 등록한 사진만 조회
    let photoQuery = supabase
      .from("post_photos")
      .select("storage_path")
      .eq("post_id", postId);

    if (!isAdmin) {
      photoQuery = photoQuery.eq("author_id", currentUser.id);
    }

    const { data: photoRows, error: photoQueryError } =
      await photoQuery;

    if (photoQueryError) throw photoQueryError;

    const paths = (photoRows || [])
      .map((photo) => photo.storage_path)
      .filter(Boolean);

    // 비공개 Storage에서 실제 사진 파일 삭제
    if (paths.length > 0) {
      const { error: storageError } = await supabase.storage
        .from("trip-photos")
        .remove(paths);

      if (storageError) throw storageError;
    }

    // 사진 메타데이터 삭제
    let metadataQuery = supabase
      .from("post_photos")
      .delete()
      .eq("post_id", postId);

    if (!isAdmin) {
      metadataQuery = metadataQuery.eq("author_id", currentUser.id);
    }

    const { error: metadataError } = await metadataQuery;

    if (metadataError) throw metadataError;

    // 게시글 삭제
    let postQuery = supabase
      .from("posts")
      .delete()
      .eq("id", postId);

    if (!isAdmin) {
      postQuery = postQuery.eq("author_id", currentUser.id);
    }

    const { error: postError } = await postQuery;

    if (postError) throw postError;

    setMessage(
      $("#board-message"),
      isAdmin
        ? "게시글과 첨부 사진을 삭제했어요."
        : "내 게시글과 첨부 사진을 삭제했어요."
    );

    await loadPosts();
  } catch (error) {
    console.error("게시글 삭제 오류:", error);

    setMessage(
      $("#board-message"),
      "삭제에 실패했어요. 관리자 권한과 Storage/RLS 정책을 확인해 주세요.",
      true
    );
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
      console.error("음악 재생 실패:", {
        name: error.name,
        message: error.message,
        src: audio.currentSrc,
        readyState: audio.readyState,
        networkState: audio.networkState,
      });
    
      button.setAttribute("aria-pressed", "false");
      $("#music-label").textContent = "PLAY ERROR";
    
      alert(
        `음악 재생 실패\n` +
        `오류 유형: ${error.name}\n` +
        `상세 내용: ${error.message || "상세 정보 없음"}\n` +
        `파일 주소: ${audio.currentSrc}`
      );
    }
  } else {
    audio.pause();
    button.setAttribute("aria-pressed", "false");
    $("#music-label").textContent = "MUSIC OFF";
  }
});


/* 게시글 사진 원본 보기 및 갤러리 */
(() => {
  const lightbox = document.getElementById("photo-lightbox");
  const lightboxImage = document.getElementById("lightbox-image");
  const counter = document.getElementById("lightbox-counter");
  const closeButton = document.getElementById("lightbox-close");
  const prevButton = document.getElementById("lightbox-prev");
  const nextButton = document.getElementById("lightbox-next");

  if (
    !lightbox ||
    !lightboxImage ||
    !counter ||
    !closeButton ||
    !prevButton ||
    !nextButton
  ) {
    return;
  }

  let gallery = [];
  let currentIndex = 0;
  let touchStartX = 0;

  function renderPhoto() {
    if (!gallery.length) return;

    lightboxImage.src = gallery[currentIndex].src;
    lightboxImage.alt = gallery[currentIndex].alt || "원본 사진";
    counter.textContent = `${currentIndex + 1} / ${gallery.length}`;

    const multiple = gallery.length > 1;
    prevButton.hidden = !multiple;
    nextButton.hidden = !multiple;
    counter.hidden = !multiple;
  }

  function openPhoto(images, index) {
    gallery = images;
    currentIndex = index;

    renderPhoto();
    lightbox.classList.add("is-open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    closeButton.focus();
  }

  function closePhoto() {
    lightbox.classList.remove("is-open");
    lightbox.setAttribute("aria-hidden", "true");
    lightboxImage.removeAttribute("src");
    document.body.style.overflow = "";
    gallery = [];
  }

  function movePhoto(direction) {
    if (gallery.length < 2) return;

    currentIndex =
      (currentIndex + direction + gallery.length) % gallery.length;

    renderPhoto();
  }

  // 게시글 사진은 나중에 로드되어도 클릭할 수 있도록 이벤트 위임 사용
  
document.addEventListener("click", (event) => {
  const clickedImage = event.target.closest(
    ".post-photo-grid img, .photo-grid img"
  );

  if (!clickedImage) return;

  const postCard = clickedImage.closest(
    ".post-card, .home-post-card"
  );

  const photoGrid = clickedImage.closest(
    ".post-photo-grid, .photo-grid"
  );

  const scope = postCard || photoGrid;
  if (!scope) return;

  const images = Array.from(scope.querySelectorAll("img"))
    .filter((img) => img.src);

  const index = images.indexOf(clickedImage);
  if (index < 0) return;

  event.preventDefault();
  openPhoto(images, index);
});


  closeButton.addEventListener("click", closePhoto);
  prevButton.addEventListener("click", () => movePhoto(-1));
  nextButton.addEventListener("click", () => movePhoto(1));

  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closePhoto();
  });

  document.addEventListener("keydown", (event) => {
    if (!lightbox.classList.contains("is-open")) return;

    if (event.key === "Escape") closePhoto();
    if (event.key === "ArrowLeft") movePhoto(-1);
    if (event.key === "ArrowRight") movePhoto(1);
  });

  lightbox.addEventListener(
    "touchstart",
    (event) => {
      touchStartX = event.changedTouches[0].clientX;
    },
    { passive: true }
  );

  lightbox.addEventListener(
    "touchend",
    (event) => {
      const touchEndX = event.changedTouches[0].clientX;
      const difference = touchEndX - touchStartX;

      if (Math.abs(difference) > 50) {
        movePhoto(difference < 0 ? 1 : -1);
      }
    },
    { passive: true }
  );
})();


initializeApp();
