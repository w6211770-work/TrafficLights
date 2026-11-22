let signals = [];
const selectEl = document.getElementById('signalSelect');
const simTimeInputEl = document.getElementById('simTimeInput');
const simSearchBtnEl = document.getElementById('simSearchBtn');
const simClearBtnEl = document.getElementById('simClearBtn');
const simResultEl = document.getElementById('simResult');

let currentIndex = 0;
let simulatedSecOfDay = null; // null のときは現在時刻を使用、数値（0〜86399）のときは指定時刻を表示

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
    } catch (error) {
        console.error('CSVの読み込みに失敗しました:', error);
        document.getElementById('signalText').textContent = 'CSV読み込みエラー';
        document.getElementById('cycleInfo').textContent = 'signals.csvが同じフォルダにあるか確認してください。';
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

// "HH:MM" または "HH:MM:SS" をその日の0時からの経過秒数に変換するヘルパー関数
function timeStrToSeconds(timeStr) {
    const parts = timeStr.trim().split(':').map(Number);
    const h = parts[0] || 0;
    const m = parts[1] || 0;
    const s = parts[2] || 0;
    return h * 3600 + m * 60 + s;
}

// 経過秒数（0〜86399）を "HH:MM:SS" に変換するヘルパー関数
function secondsToTimeStr(totalSec) {
    const clamped = ((totalSec % 86400) + 86400) % 86400;
    const h = String(Math.floor(clamped / 3600)).padStart(2, '0');
    const m = String(Math.floor((clamped % 3600) / 60)).padStart(2, '0');
    const s = String(clamped % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
}

// 指定した1日の経過秒数における信号状態を計算する関数
function evaluateSignalAt(row, targetSecOfDay) {
    const startSec = timeStrToSeconds(row['通常運転開始時刻']);
    const endSec = timeStrToSeconds(row['夜間運転開始時刻']);

    const blueSec = parseInt(row['青秒数'], 10);
    const yellowSec = parseInt(row['黄秒数'], 10);
    const redSec = parseInt(row['赤秒数'], 10);
    const totalCycle = blueSec + yellowSec + redSec;

    // 1. 通常運転時間外の判定
    if (targetSecOfDay < startSec || targetSecOfDay > endSec) {
        return {
            isNight: true,
            colorClass: 'night',
            currentColor: '夜間',
            signalText: `${row['信号機名']} (夜間)`,
            countdownText: '夜間',
            unitText: `${row['通常運転開始時刻']} 再開`,
            cycleInfo: `通常運転: ${row['通常運転開始時刻']} 〜 ${row['夜間運転開始時刻']}`
        };
    }

    // 2. サイクル位置の計算
    const elapsedSeconds = targetSecOfDay - startSec;
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

    return {
        isNight: false,
        colorClass,
        currentColor,
        remainingSec,
        signalText: `${row['信号機名']} : ${currentColor}`,
        countdownText: remainingSec,
        unitText: '秒',
        cycleInfo: `青:${blueSec}秒 / 黄:${yellowSec}秒 / 赤:${redSec}秒 (位置: ${cyclePos}/${totalCycle}秒)`
    };
}

// 指定時刻の検索を実行
function applySimulatedTime() {
    if (!simTimeInputEl) return;
    const rawVal = simTimeInputEl.value.trim();
    if (!rawVal) {
        clearSimulatedTime();
        return;
    }

    const sec = timeStrToSeconds(rawVal);
    if (Number.isNaN(sec) || sec < 0 || sec >= 86400) {
        if (simResultEl) {
            simResultEl.textContent = '時刻は HH:MM または HH:MM:SS 形式で入力してください。';
        }
        return;
    }

    simulatedSecOfDay = sec;
    updateSignal();
}

// 指定時刻を解除して現在時刻に戻す
function clearSimulatedTime() {
    simulatedSecOfDay = null;
    if (simTimeInputEl) {
        simTimeInputEl.value = '';
    }
    if (simResultEl) {
        simResultEl.textContent = '';
    }
    updateSignal();
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

// 指定時刻のイベント登録
if (simSearchBtnEl) {
    simSearchBtnEl.addEventListener('click', applySimulatedTime);
}
if (simTimeInputEl) {
    simTimeInputEl.addEventListener('change', applySimulatedTime);
}
if (simClearBtnEl) {
    simClearBtnEl.addEventListener('click', clearSimulatedTime);
}

// 毎秒実行される更新処理
function updateSignal() {
    if (signals.length === 0) return;

    const now = new Date();
    const currentSecOfDay = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();

    // 現在時刻の表示更新
    const timeFormatted = now.toTimeString().split(' ')[0];
    document.getElementById('currentClock').textContent = `現在時刻: ${timeFormatted}`;

    // 表示対象となる時刻（指定時刻があればそちらを優先）
    const activeSecOfDay = simulatedSecOfDay !== null ? simulatedSecOfDay : currentSecOfDay;
    const row = signals[currentIndex];
    const state = evaluateSignalAt(row, activeSecOfDay);

    const bodyEl = document.body;
    const signalTextEl = document.getElementById('signalText');
    const countdownTextEl = document.getElementById('countdownText');
    const unitTextEl = document.getElementById('unitText');
    const cycleInfoEl = document.getElementById('cycleInfo');

    bodyEl.className = state.colorClass;
    signalTextEl.textContent = simulatedSecOfDay !== null
        ? `${state.signalText} [指定 ${secondsToTimeStr(simulatedSecOfDay)}]`
        : state.signalText;
    countdownTextEl.textContent = state.countdownText;
    unitTextEl.textContent = state.unitText;
    cycleInfoEl.textContent = state.cycleInfo;

    if (simResultEl) {
        if (simulatedSecOfDay !== null) {
            const targetStr = secondsToTimeStr(simulatedSecOfDay);
            simResultEl.textContent = state.isNight
                ? `${targetStr} 時点の ${row['信号機名']}：夜間運転中`
                : `${targetStr} 時点の ${row['信号機名']}：「${state.currentColor}」（残り ${state.remainingSec} 秒）`;
        } else {
            simResultEl.textContent = '';
        }
    }
}

// 画面タップ（クリック）で次の信号に切り替え（プルダウンや指定時刻の操作時は除外）
document.body.addEventListener('click', (event) => {
    if (event.target.closest('#signalSelect, #simControls')) return;
    nextSignal();
});

// 起動時にCSVデータを読み込む
loadSignalsData();