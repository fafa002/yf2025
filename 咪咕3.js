// 咪咕3.js —— 仅使用 52top TXT 源，按给定 id 列表匹配
// 数据源: http://www.52top.com.cn:678/downloads/migu.txt

var MIGU_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Linux; Android 10; Pixel 3) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/90.0.4430.91 Mobile Safari/537.36",
    "Referer": "https://www.miguvideo.com/"
};

function main(item) {
    var channelId = (item && item.id) || "";
    if (!channelId) return { error: "未提供频道ID (item.id)" };

    var source = "http://www.52top.com.cn:678/downloads/migu.txt";
    var result = fetchAndMatch(source, channelId);

    if (result.url) {
        return { url: result.url, headers: MIGU_HEADERS };
    }
    return { error: result.error || ('未找到频道 "' + channelId + '"') };
}

// ---------- 请求 ----------
function doRequest(url) {
    try {
        var res = ku9.request(url, "GET", MIGU_HEADERS);
        if (!res) return { error: "无响应" };

        var code = (res.code !== undefined ? res.code : res.status);
        var body = (res.body !== undefined ? res.body : (typeof res === "string" ? res : res.data));

        if (body && (code === 200 || code === undefined || code === 0)) {
            return { body: body };
        }
        return { error: "状态码: " + code };
    } catch (e) {
        return { error: e.message };
    }
}

function fetchAndMatch(sourceUrl, channelId) {
    var req = doRequest(sourceUrl);
    if (req.error) return { error: "请求失败: " + req.error };

    var playlist = parseM3U(req.body);
    if (!playlist.length) playlist = parseTxt(req.body);
    if (!playlist.length) return { error: "内容解析为空（非 M3U 也非 TXT 格式）" };

    var matched = smartMatch(playlist, channelId);
    if (matched && matched.url && /^https?:\/\//i.test(matched.url)) {
        return { url: matched.url };
    }
    return { error: '未找到频道 "' + channelId + '"' };
}

// ---------- 名称规范化 ----------
function normalize(str) {
    return String(str || "")
        .replace(/\s+/g, "")
        .replace(/[-_·（）()【】\[\]]/g, "")
        .toLowerCase();
}

// 生成匹配目标：原 id + CCTV 基础频道名 + 常见别名
function buildTargets(channelId) {
    var norm = normalize(channelId);
    var targets = [norm];

    // CCTV5+体育赛事 → 允许 cctv5+ / cctv5plus
    if (norm.indexOf("cctv5+") === 0) {
        targets.push("cctv5+");
        targets.push("cctv5plus");
    }

    // CCTV1综合 → cctv1；CCTV2财经 → cctv2 ...
    // 但 CCTV4欧洲/美洲 不加入 cctv4，避免误配主频道
    var m = norm.match(/^cctv(\d+)(.*)$/);
    if (m) {
        var num = m[1];
        var suffix = m[2] || "";
        var isCctv4Region = (num === "4" && (suffix.indexOf("欧洲") !== -1 || suffix.indexOf("美洲") !== -1));
        var isCctv5Plus = (num === "5" && suffix.indexOf("+") === 0);
        if (!isCctv4Region && !isCctv5Plus) {
            targets.push("cctv" + num);
        }
    }

    // CGTN 各语言常见别名（不加入裸 cgtn，避免全部命中 CGTN 主频道）
    if (norm === "cgtn纪录" || norm === "cgtn记录") {
        targets.push("cgtndoc", "cgtndocumentary");
    } else if (norm.indexOf("cgtn阿拉伯") !== -1) {
        targets.push("cgtnar", "cgtn阿拉伯语", "cgtn阿语");
    } else if (norm.indexOf("cgtn西班牙") !== -1) {
        targets.push("cgtnes", "cgtn西班牙语", "cgtn西语");
    } else if (norm === "cgtn法语") {
        targets.push("cgtnfr");
    } else if (norm === "cgtn俄语") {
        targets.push("cgtnru");
    }

    // CCTV4 欧洲/美洲常见写法
    if (norm === "cctv4欧洲") targets.push("cctv4ou", "cctv4europe");
    if (norm === "cctv4美洲") targets.push("cctv4mei", "cctv4america");

    // 去重
    var out = [];
    for (var i = 0; i < targets.length; i++) {
        if (targets[i] && out.indexOf(targets[i]) === -1) out.push(targets[i]);
    }
    return out;
}

function smartMatch(playlist, channelId) {
    var targets = buildTargets(channelId);
    if (!targets.length) return null;

    var exact = null;
    var prefix = null;
    var contains = null;

    for (var i = 0; i < playlist.length; i++) {
        var entry = playlist[i];
        if (!entry.url || !/^https?:\/\//i.test(entry.url)) continue;

        var names = [
            normalize(entry.tvgId),
            normalize(entry.tvgName),
            normalize(entry.channelName)
        ];

        for (var j = 0; j < names.length; j++) {
            var name = names[j];
            if (!name) continue;

            for (var k = 0; k < targets.length; k++) {
                var target = targets[k];

                if (name === target) {
                    if (!exact) exact = entry;
                } else if (name.indexOf(target) === 0 || target.indexOf(name) === 0) {
                    if (!prefix) prefix = entry;
                } else if (name.indexOf(target) !== -1 || target.indexOf(name) !== -1) {
                    if (!contains) contains = entry;
                }
            }
        }
    }

    return exact || prefix || contains || null;
}

// ---------- M3U 解析 ----------
function parseM3U(text) {
    var lines = String(text || "").split(/\r?\n/);
    var entries = [];
    var pending = null;
    var urlBuffer = "";

    for (var i = 0; i < lines.length; i++) {
        var raw = lines[i].trim();
        if (!raw) continue;

        if (raw.indexOf("#EXTINF:") === 0) {
            if (pending && urlBuffer) {
                pending.url = urlBuffer;
                entries.push(pending);
            }
            pending = parseExtInf(raw);
            urlBuffer = "";
            continue;
        }

        if (raw.charAt(0) === "#") continue;
        if (pending) urlBuffer += raw;
    }

    if (pending && urlBuffer) {
        pending.url = urlBuffer;
        entries.push(pending);
    }
    return entries;
}

function parseExtInf(line) {
    var result = { tvgId: "", tvgName: "", channelName: "" };

    var idMatch = line.match(/tvg-id="([^"]*)"/);
    if (idMatch) result.tvgId = idMatch[1];

    var nameMatch = line.match(/tvg-name="([^"]*)"/);
    if (nameMatch) result.tvgName = nameMatch[1];

    var commaIndex = line.lastIndexOf(",");
    if (commaIndex !== -1) {
        result.channelName = line.substring(commaIndex + 1).trim();
    }
    return result;
}

// ---------- TXT 解析：频道名,URL ----------
function parseTxt(text) {
    var lines = String(text || "").split(/\r?\n/);
    var entries = [];

    for (var i = 0; i < lines.length; i++) {
        var raw = lines[i].trim();
        if (!raw || raw.charAt(0) === "#") continue;

        var commaIndex = raw.indexOf(",");
        if (commaIndex === -1) continue;

        var channelName = raw.substring(0, commaIndex).trim();
        var urlPart = raw.substring(commaIndex + 1).trim();

        var dollarIndex = urlPart.indexOf("$");
        if (dollarIndex !== -1) urlPart = urlPart.substring(0, dollarIndex);

        var spaceIndex = urlPart.indexOf(" ");
        if (spaceIndex !== -1) urlPart = urlPart.substring(0, spaceIndex);

        urlPart = urlPart.trim();
        if (!/^https?:\/\//i.test(urlPart)) continue;

        entries.push({
            tvgId: "",
            tvgName: "",
            channelName: channelName,
            url: urlPart
        });
    }
    return entries;
}
