let signals = [];
const selectEl = document.getElementById('signalSelect');
let currentIndex = 0; // ← スペルミス修正 (crrentIndex -> currentIndex)

// CSVをパースしてオブジェクト配列に変換
function parseCSV(csv) {
    const lines = csv.trim().split(/\r?\n/).filter(line => line.trim() !== '');
    const headers = lines[0].split(',');
    return lines.slice(1).map(line => {
        const values = line.split(',');
        let obj = {};
        headers.forEach((h, i) => {
            obj[h.trim()] = values[i] ? values[i].trim() : '';
        });
        return obj;
    });
}

// 外部CSVファイルを読み込んで初期化する処理
async function loadSignalsData() {
    try {
        const response = await fetch('signals.csv');
        if (!response.ok) {
            throw new Error(`HTTPエラー: ${response.status}`);
        }
        const csvText = await response.text();
        signals = parseCSV(csvText);

        if (signals.length === 0) {
            throw new Error('CSVにデータが含まれていません。');
        }

        // プルダウンメニューの生成
        selectEl.innerHTML = '';
        signals.forEach((sig, index) => {
            const option = document.createElement('option');
            option.value = index;
            option.textContent = `${sig['主キー']}: ${sig['信号機名']}`;
            selectEl.appendChild(option);
        });

        // データ読み込み完了後に初回実行＆1秒ごとの更新を開始
        updateSignal();
        scheduleNextTick();
        // setInterval(updateSignal, 1000); // ← スペルミス修正 (updadeSignal -> updateSignal)
    
    } catch (error) {
        console.error('CSVの読み込みに失敗しました:', error);
        document.getElementById('signalText').textContent = 'CSV読み込みエラー';
        document.getElementById('cycleInfo').textContent = 'signals.csvが同じフォルダにあるか確認してください。'; // ← domument -> document 修正
    }
}

// 次の秒の変わり目（ミリ秒が 0 になる瞬間）ぴったりに updateSignal() を実行するための関数
function scheduleNextTick() {
    const now = new Date();
    const delay = 1000 - now.getMilliseconds();
    setTimeout(() => {
        updateSignal();
        scheduleNextTick();
    }, delay);
}

// "HH:MM:SS" をその日の0時からの経過秒数に変換するヘルパー関数
function timeStrToSeconds(timeStr) {
    const [h, m, s] = timeStr.split(':').map(Number);
    return h * 3600 + m * 60 + s;
}

// 次の信号に切り替える関数
function nextSignal() {
    if (signals.length === 0) return;
    currentIndex = (currentIndex + 1) % signals.length;
    selectEl.value = currentIndex;
    updateSignal();
}

// プルダウンを手動で変更したとき
selectEl.addEventListener('change', () => {
    currentIndex = parseInt(selectEl.value, 10);
    updateSignal();
});

// 毎秒実行される更新処理
function updateSignal() {
    if (signals.length === 0) return;

    const now = new Date();
    const currentSecOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    // 現在時刻の表示更新
    const timeFormatted = now.toTimeString().split(' ')[0];
    document.getElementById('currentClock').textContent = `現在時刻: ${timeFormatted}`;

    // 選択中の信号機データを取得
    const row = signals[currentIndex];
    const startSec = timeStrToSeconds(row['通常運転開始時刻']);
    const endSec = timeStrToSeconds(row['夜間運転開始時刻']);

    const blueSec = parseInt(row['青秒数'], 10);
    const yellowSec = parseInt(row['黄秒数'], 10);
    const redSec = parseInt(row['赤秒数'], 10);
    const totalCycle = blueSec + yellowSec + redSec;

    const bodyEl = document.body;
    const signalTextEl = document.getElementById('signalText');
    const countdownTextEl = document.getElementById('countdownText');
    const unitTextEl = document.getElementById('unitText');
    const cycleInfoEl = document.getElementById('cycleInfo');

    // 1. 通常運転時間外の判定
    if (currentSecOfDay < startSec || currentSecOfDay > endSec) {
        bodyEl.className = 'night';
        signalTextEl.textContent = `${row['信号機名']} (夜間)`;
        countdownTextEl.textContent = '夜間';
        unitTextEl.textContent = `${row['通常運転開始時刻']} 再開`;
        cycleInfoEl.textContent = `通常運転: ${row['通常運転開始時刻']} 〜 ${row['夜間運転開始時刻']}`;
        return;
    }

    // 2. サイクル位置の計算
    const elapsedSeconds = currentSecOfDay - startSec;
    const cyclePos = elapsedSeconds % totalCycle;

    let currentColor = '';
    let remainingSec = 0;
    let colorClass = '';

    // 3. 色と残り秒数の判定
    if (cyclePos < blueSec) {
        currentColor = '青';
        remainingSec = blueSec - cyclePos;
        colorClass = 'blue';
    } else if (cyclePos < (blueSec + yellowSec)) {
        currentColor = '黄';
        remainingSec = (blueSec + yellowSec) - cyclePos;
        colorClass = 'yellow';
    } else {
        currentColor = '赤';
        remainingSec = totalCycle - cyclePos;
        colorClass = 'red';
    }

    // 4. 画面表示の反映
    bodyEl.className = colorClass;
    signalTextEl.textContent = `${row['信号機名']} : ${currentColor}`;
    countdownTextEl.textContent = remainingSec;
    unitTextEl.textContent = '秒';
    cycleInfoEl.textContent = `青:${blueSec}秒 / 黄:${yellowSec}秒 / 赤:${redSec}秒 (位置: ${cyclePos}/${totalCycle}秒)`;
}

// --- Web Audio API を用いたオフライン音声（衝撃音・拍手等）検知 ---
let isAudioActive = false;
const audioStatusEl = document.getElementById('audioStatus');

function initAudioTrigger() {
    if (isAudioActive) return;

    navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        .then(stream => {
            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioCtx.createMediaStreamSource(stream);
            const analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            isAudioActive = true;
            audioStatusEl.textContent = "音声検知: 作動中（音を鳴らして切替）";

            let lastTriggerTime = 0;

            function checkVolume() {
                analyser.getByteFrequencyData(dataArray);
                let sum = dataArray.reduce((a, b) => a + b, 0);
                let average = sum / dataArray.length;

                // 閾値（環境の騒音に合わせて調整可能。例: 60以上）
                const threshold = 60; 
                const nowTime = Date.now();

                // 一定以上の音量を検知し、かつ前回の検知から1秒以上空いている場合
                if (average > threshold && (nowTime - lastTriggerTime) > 1000) {
                    lastTriggerTime = nowTime;
                    audioStatusEl.textContent = `音声検知: 音を検知 (${Math.round(average)}) → 次へ切替`;
                    nextSignal();
                }

                requestAnimationFrame(checkVolume);
            }
            checkVolume();
        })
        .catch(err => {
            console.warn("マイクの利用が許可されませんでした:", err);
            audioStatusEl.textContent = "音声検知: マイクエラー（画面タップで切替可能）";
            // フォールバック：マイクが使えない場合は画面タップで切り替え
            document.body.addEventListener('click', nextSignal);
        });
}

// ブラウザの仕様（自動再生ポリシー）により、最初のユーザー操作（画面タップ）でマイクを起動
document.body.addEventListener('click', initAudioTrigger, { once: true });

// 起動時にCSVデータを読み込む
loadSignalsData();

// 下記の通りとなるので気を付ける。
// 縦：青30黄3赤40
// 横：赤33黄3青37
// 横の赤＝縦の青+縦の黄
// 横の黄＝縦の黄
// 横の青＝縦の赤-縦の黄

// KOTOBUKITYOUは合っていた。17：15ごろ。スマホのほうが0.5～１秒程度早く表示されていた。