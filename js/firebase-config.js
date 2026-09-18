// Firebase 프로젝트 설정
// Firebase 콘솔 > 프로젝트 설정 > 내 앱 > SDK 설정 및 구성 에서 복사해 붙여넣으세요.
// apiKey 가 비어 있으면 앱은 브라우저 localStorage 에 저장하는 "로컬 모드"로 동작합니다.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: "",
};

// 비밀번호 리셋용 버전 번호.
// 숫자를 1 올리면 해당 가정 탭의 기존 비밀번호가 무효화되고, 다음 접속자가 새 비밀번호를 설정하게 됩니다.
export const PASSWORD_VERSION = {
  salt: 1,   // 소금이네
  bean: 1,   // 콩콩이네
};
