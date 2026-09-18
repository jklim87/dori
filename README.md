# 자식된 도리

가족 행사(부모님 생신, 어버이날, 명절 등)에 소금이네와 콩콩이네가 각각 무엇을 했는지 연도별로 기록하는 모바일 웹 페이지.
빌드 도구 없이 정적 파일(HTML/CSS/JS)만으로 구성되어 GitHub Pages에 바로 올릴 수 있고, 데이터는 Firebase Firestore에 저장한다.

## 구조

```
index.html            메인 페이지 (모바일 우선)
css/style.css         스타일
js/app.js             화면/라우팅/비밀번호 게이트
js/db.js              저장소 어댑터 (Firestore 또는 로컬 localStorage)
js/lunar.js           음력/양력 변환 (korean-lunar-calendar CDN 사용)
js/firebase-config.js Firebase 설정 + 비밀번호 리셋 버전
assets/logo.svg       아이콘 (선물 상자)
assets/salt.svg       소금이네 탭 아이콘 (유리 소금통)
assets/bean.svg       콩콩이네 탭 아이콘 (콩깍지)
firestore.rules       Firestore 보안 규칙
```

## 기능

- 탭 3개: 공통(전체 공개), 소금이네, 콩콩이네(비밀번호 필요)
- 이벤트 등록: 제목, 유형(매년 반복 / 일회성), 날짜 기준(양력 / 음력), 날짜
- 음력 이벤트는 올해(또는 내년) 양력 날짜와 D-day를 자동 계산
- 메인 화면은 카드 목록(가장 가까운 일정이 맨 위). 유형 필터(전체 / 매년 / 일회성) 제공
- 이벤트 상세: 연도별 카드(최근 연도가 맨 위). 카드를 누르면 펼쳐져 내용 수정/삭제 가능, 동시에 하나만 열림
- 내역 연도 선택은 2026년부터 향후 20년(2046년)까지, 연도당 기록 1건
- 내역, 이벤트 수정 및 삭제

## 로컬 테스트

`js/firebase-config.js`의 `apiKey`가 비어 있으면 브라우저 localStorage에 저장하는 **로컬 모드**로 동작한다.
ES 모듈을 쓰므로 파일을 직접 열지 말고 로컬 서버로 띄운다.

```bash
python -m http.server 8765
```

브라우저에서 http://127.0.0.1:8765 접속. 모바일 화면은 개발자 도구의 기기 모드로 확인.

## Firebase 설정

1. https://console.firebase.google.com 에서 프로젝트 생성 (Google 애널리틱스는 꺼도 됨)
2. 빌드 > Firestore Database > 데이터베이스 만들기 (위치는 asia-northeast3 서울 권장, 프로덕션 모드)
3. Firestore > 규칙 탭에 `firestore.rules` 내용을 붙여넣고 게시
4. 프로젝트 설정(톱니바퀴) > 내 앱 > 웹 앱(</>) 추가 > `firebaseConfig` 값 복사
5. `js/firebase-config.js`의 `firebaseConfig`에 붙여넣기
6. 프로젝트 설정 > 일반 > 승인된 도메인에 `jklim87.github.io` 추가 (Authentication 메뉴에서 설정. Firestore 단독 사용 시 생략 가능)

## GitHub Pages 배포

1. 이 폴더 내용을 https://github.com/jklim87/dori 저장소 루트에 push
2. 저장소 Settings > Pages > Source: Deploy from a branch, Branch: main / (root)
3. 잠시 후 https://jklim87.github.io/dori/ 에서 접속 가능

`.nojekyll` 파일이 있어 Jekyll 처리 없이 그대로 서빙된다.

## 비밀번호 동작 방식

- 소금이네, 콩콩이네 탭에 처음 들어가면 비밀번호 설정(입력 + 확인) 화면이 뜬다.
- 비밀번호는 SHA-256 해시로 Firestore `auth/{family}_v{N}` 문서에 저장되며 원문은 저장하지 않는다.
- 한 번 설정된 해시 문서는 규칙상 수정/삭제가 불가능하다.
- 입장에 성공하면 이 기기(localStorage)에 기억되어 다음부터 바로 열린다. 목록 하단 "이 기기에서 잠그기"로 해제할 수 있다.

### 비밀번호 리셋 (관리자)

`js/firebase-config.js`의 `PASSWORD_VERSION`에서 해당 가정의 숫자를 1 올리고 배포하면
기존 비밀번호가 무효화되고, 다음 접속자가 새 비밀번호를 설정하게 된다.

```js
export const PASSWORD_VERSION = {
  salt: 2,   // 1 -> 2 로 올리면 소금이네 비밀번호 리셋
  bean: 1,
};
```

## 데이터 구조 (Firestore)

```
auth/{family}_v{N}          { hash, createdAt }
events/{eventId}            { family, title, type, calendar, year?, month, day,
                              logCount, lastYear, lastSummary, createdAt, updatedAt }
events/{eventId}/logs/{id}  { year, content, createdAt, updatedAt }
```

- `family`: common | salt(소금이네) | bean(콩콩이네)
- `type`: annual(매년) | once(일회성). once 는 `year` 필수
- `calendar`: solar | lunar
