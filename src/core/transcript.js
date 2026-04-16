const { AttachmentBuilder } = require('discord.js');

async function fetchAllMessages(channel) {
    const collected = [];
    let before;

    while (true) {
        const batch = await channel.messages.fetch({ limit: 100, before });
        if (!batch.size) break;
        collected.push(...batch.values());
        before = batch.last().id;
    }

    return collected.reverse();
}

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatTimestamp(date) {
    const source = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(source.getTime())) {
        return 'Unknown time';
    }

    return source.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: 'numeric',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

function formatTextContent(value) {
    if (!value?.trim()) {
        return '<span class="muted">[no text]</span>';
    }

    let formatted = escapeHtml(value);

    formatted = formatted.replace(
        /&lt;a?:([a-zA-Z0-9_]+):(\d+)&gt;/g,
        (_, name, id) => {
            const ext = value.includes(`<a:${name}:${id}>`) ? 'gif' : 'png';
            const src = `https://cdn.discordapp.com/emojis/${id}.${ext}?size=48&quality=lossless`;
            return `<span class="custom-emoji-wrap"><img class="custom-emoji" src="${src}" alt=":${escapeHtml(name)}:"><span class="emoji-name">:${escapeHtml(name)}:</span></span>`;
        }
    );

    formatted = formatted.replace(/&lt;@!?(\d+)&gt;/g, '<span class="mention user">@$1</span>');
    formatted = formatted.replace(/&lt;#(\d+)&gt;/g, '<span class="mention channel">#$1</span>');
    formatted = formatted.replace(/&lt;@&(\d+)&gt;/g, '<span class="mention role">@&$1</span>');

    formatted = formatted.replace(
        /(https?:\/\/[^\s<]+)/g,
        (url) => `<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`
    );

    formatted = formatted.replace(/```([\s\S]*?)```/g, '<pre class="code-block"><code>$1</code></pre>');
    formatted = formatted.replace(/`([^`\n]+)`/g, '<code class="inline-code">$1</code>');
    formatted = formatted.replace(/^### (.+)$/gm, '<span class="md-heading heading-3">$1</span>');
    formatted = formatted.replace(/^## (.+)$/gm, '<span class="md-heading heading-2">$1</span>');
    formatted = formatted.replace(/^# (.+)$/gm, '<span class="md-heading heading-1">$1</span>');
    formatted = formatted.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    formatted = formatted.replace(/^&gt; (.+)$/gm, '<span class="md-quote">$1</span>');
    formatted = formatted.replace(/\r?\n/g, '<br>');

    return formatted;
}

function getComponentText(component) {
    if (!component || typeof component !== 'object') return '';

    if (typeof component.content === 'string' && component.content.trim()) {
        return component.content;
    }

    const parts = [];

    if (Array.isArray(component.components)) {
        parts.push(...component.components.map(getComponentText));
    }

    if (component.accessory) {
        parts.push(getComponentText(component.accessory));
    }

    return parts.filter(Boolean).join('\n');
}

function flattenButtons(component, bucket = []) {
    if (!component || typeof component !== 'object') return bucket;

    const hasLabel = typeof component.label === 'string' && component.label.trim();
    const hasUrl = typeof component.url === 'string' && component.url.trim();
    const hasCustomId = typeof component.custom_id === 'string' || typeof component.customId === 'string';

    if (hasLabel && (hasUrl || hasCustomId)) {
        bucket.push({
            label: component.label,
            url: component.url || null,
            disabled: Boolean(component.disabled)
        });
    }

    if (component.accessory) {
        flattenButtons(component.accessory, bucket);
    }

    if (Array.isArray(component.components)) {
        component.components.forEach((child) => flattenButtons(child, bucket));
    }

    return bucket;
}

function renderComponents(msg) {
    if (!msg.components?.length) return '';

    const textBlocks = [];
    const buttons = [];

    for (const component of msg.components) {
        const text = getComponentText(component).trim();
        if (text) {
            textBlocks.push(text);
        }
        flattenButtons(component, buttons);
    }

    if (!textBlocks.length && !buttons.length) return '';

    const textHtml = textBlocks.length
        ? `<div class="component-text">${textBlocks.map((block) => `<div class="component-block">${formatTextContent(block)}</div>`).join('')}</div>`
        : '';

    const buttonHtml = buttons.length
        ? `<div class="component-buttons">${buttons.map((button) => {
            const classes = ['component-button'];
            if (button.disabled) classes.push('disabled');

            if (button.url) {
                return `<a class="${classes.join(' ')}" href="${escapeHtml(button.url)}" target="_blank" rel="noreferrer">${escapeHtml(button.label)}</a>`;
            }

            return `<span class="${classes.join(' ')}">${escapeHtml(button.label)}</span>`;
        }).join('')}</div>`
        : '';

    return `<div class="component-card">${textHtml}${buttonHtml}</div>`;
}

function safeFilePart(value) {
    return String(value ?? 'ticket')
        .replace(/[^a-z0-9-_]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'ticket';
}

function renderAttachmentList(msg) {
    if (!msg.attachments?.size) return '';

    const items = Array.from(msg.attachments.values()).map((attachment) => {
        const label = escapeHtml(attachment.name || 'attachment');
        const url = escapeHtml(attachment.url);
        const size = Number.isFinite(attachment.size) ? `${attachment.size} bytes` : 'attachment';
        return `<li><a href="${url}" target="_blank" rel="noreferrer">${label}</a> <span>${escapeHtml(size)}</span></li>`;
    });

    return `
        <div class="attachments">
            <div class="attachments-title">Attachments</div>
            <ul>${items.join('')}</ul>
        </div>
    `;
}

function renderEmbeds(msg) {
    if (!msg.embeds?.length) return '';

    const items = msg.embeds.map((embed) => {
        const color = embed.hexColor || '#4f545c';
        const author = embed.author?.name
            ? `<div class="embed-author">${escapeHtml(embed.author.name)}</div>`
            : '';
        const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : '';
        const description = embed.description
            ? `<div class="embed-description">${formatTextContent(embed.description)}</div>`
            : '';
        const fields = embed.fields?.length
            ? `<div class="embed-fields">${embed.fields.map((field) => `
                <div class="embed-field">
                    <div class="embed-field-name">${escapeHtml(field.name)}</div>
                    <div class="embed-field-value">${formatTextContent(field.value)}</div>
                </div>
            `).join('')}</div>`
            : '';
        const footer = embed.footer?.text
            ? `<div class="embed-footer">${escapeHtml(embed.footer.text)}</div>`
            : '';

        return `
            <div class="embed-card" style="border-left-color: ${escapeHtml(color)};">
                ${author}
                ${title}
                ${description}
                ${fields}
                ${footer}
            </div>
        `;
    });

    return `<div class="embed-list">${items.join('')}</div>`;
}

function renderMessage(msg) {
    const createdAt = msg.createdAt?.toISOString?.() || new Date().toISOString();
    const createdLabel = formatTimestamp(msg.createdAt || createdAt);
    const username = msg.author?.username || 'Unknown';
    const authorTag = msg.author?.tag || 'Unknown';
    const authorId = msg.author?.id || 'unknown';
    const avatarUrl = msg.author?.displayAvatarURL?.({ extension: 'png', size: 128 }) || '';
    const content = formatTextContent(msg.content);

    return `
        <article class="message">
            <div class="avatar-wrap">
                ${avatarUrl ? `<img class="avatar" src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(authorTag)} avatar">` : '<div class="avatar placeholder"></div>'}
            </div>
            <div class="message-body">
                <div class="message-meta">
                    <span class="username">${escapeHtml(username)}</span>
                    <span class="author-tag">${escapeHtml(authorTag)}</span>
                    <span class="author-id">${escapeHtml(authorId)}</span>
                    <time datetime="${escapeHtml(createdAt)}">${escapeHtml(createdLabel)}</time>
                </div>
                <div class="message-content">${content}</div>
                ${renderComponents(msg)}
                ${renderEmbeds(msg)}
                ${renderAttachmentList(msg)}
            </div>
        </article>
    `;
}

function buildParticipantSummary(messages) {
    const counts = new Map();

    for (const message of messages) {
        const key = message.author?.id || 'unknown';
        const current = counts.get(key) || {
            username: message.author?.username || 'Unknown',
            authorTag: message.author?.tag || 'Unknown',
            count: 0
        };
        current.count += 1;
        counts.set(key, current);
    }

    return Array.from(counts.values())
        .sort((left, right) => right.count - left.count)
        .slice(0, 6);
}

function buildTranscriptHtml(channel, ticketId, messages) {
    const generatedAt = new Date().toISOString();
    const generatedLabel = formatTimestamp(generatedAt);
    const title = `Transcript - ${ticketId}`;
    const subtitle = channel.name ? `#${channel.name}` : channel.id;
    const firstMessage = messages[0];
    const lastMessage = messages[messages.length - 1];
    const participantSummary = buildParticipantSummary(messages);
    const openedLabel = firstMessage ? formatTimestamp(firstMessage.createdAt) : 'Unknown';
    const closedLabel = lastMessage ? formatTimestamp(lastMessage.createdAt) : generatedLabel;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
        :root {
            color-scheme: dark;
            --bg: #10161d;
            --panel: rgba(18, 28, 39, 0.9);
            --panel-border: rgba(255, 255, 255, 0.08);
            --card: transparent;
            --card-border: transparent;
            --text: #e8eef5;
            --muted: #8ea0b3;
            --accent: #d9a441;
            --accent-strong: #f3d08a;
            --accent-soft: rgba(217, 164, 65, 0.16);
            --surface: rgba(255, 255, 255, 0.05);
            --surface-soft: rgba(255, 255, 255, 0.035);
            --line: rgba(255, 255, 255, 0.06);
            --shadow: rgba(0, 0, 0, 0.35);
            --embed: rgba(9, 14, 20, 0.78);
        }

        * {
            box-sizing: border-box;
        }

        body {
            margin: 0;
            font-family: "Segoe UI", Inter, Arial, sans-serif;
            background:
                radial-gradient(circle at top left, rgba(217, 164, 65, 0.18), transparent 24%),
                radial-gradient(circle at top right, rgba(74, 148, 205, 0.16), transparent 28%),
                linear-gradient(180deg, #0f151c 0%, #131c25 48%, #18212b 100%);
            color: var(--text);
            padding: 24px 16px 40px;
        }

        .container {
            max-width: 1000px;
            margin: 0 auto;
        }

        .header {
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 18px;
            padding: 24px;
            margin-bottom: 18px;
            box-shadow: 0 20px 60px var(--shadow);
            position: relative;
            overflow: hidden;
        }

        .header::before {
            content: "";
            position: absolute;
            inset: 0;
            background:
                linear-gradient(135deg, rgba(217, 164, 65, 0.12), transparent 38%),
                linear-gradient(315deg, rgba(74, 148, 205, 0.1), transparent 45%);
            pointer-events: none;
        }

        .eyebrow {
            color: var(--accent-strong);
            font-size: 12px;
            letter-spacing: 0.14em;
            text-transform: uppercase;
            margin-bottom: 8px;
            position: relative;
        }

        h1 {
            margin: 0 0 8px;
            font-size: 28px;
            line-height: 1.2;
            position: relative;
        }

        .subtitle {
            color: var(--muted);
            margin-bottom: 16px;
            position: relative;
            font-size: 15px;
        }

        .timeline {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 10px;
            margin-bottom: 14px;
            position: relative;
        }

        .timeline-card {
            border-radius: 12px;
            background: var(--surface-soft);
            border: 1px solid var(--panel-border);
            padding: 12px 14px;
        }

        .stats {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            position: relative;
        }

        .stat {
            background: var(--surface-soft);
            border: 1px solid var(--panel-border);
            border-radius: 12px;
            padding: 10px 12px;
            min-width: 160px;
            backdrop-filter: blur(8px);
        }

        .stat-label {
            color: var(--muted);
            font-size: 12px;
            margin-bottom: 6px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .stat-value {
            font-size: 14px;
            word-break: break-word;
        }

        .participants {
            margin-top: 14px;
            position: relative;
        }

        .participants-title {
            color: var(--accent-strong);
            text-transform: uppercase;
            letter-spacing: 0.12em;
            font-size: 11px;
            margin-bottom: 10px;
        }

        .participant-list {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
        }

        .participant-chip {
            display: inline-flex;
            gap: 8px;
            align-items: center;
            background: var(--surface-soft);
            border: 1px solid var(--panel-border);
            border-radius: 999px;
            padding: 8px 12px;
            color: var(--text);
            font-size: 13px;
        }

        .participant-count {
            color: var(--accent-strong);
            font-weight: 700;
        }

        .message-list {
            display: grid;
            gap: 0;
            background: var(--panel);
            border: 1px solid var(--panel-border);
            border-radius: 18px;
            overflow: hidden;
            box-shadow: 0 18px 50px var(--shadow);
        }

        .message {
            display: grid;
            grid-template-columns: 52px minmax(0, 1fr);
            gap: 12px;
            background: var(--card);
            border-top: 1px solid var(--line);
            padding: 14px 18px;
            transition: background 120ms ease;
        }

        .message:first-child {
            border-top: 0;
        }

        .message:hover {
            background: rgba(255, 255, 255, 0.03);
        }

        .avatar-wrap {
            display: flex;
            align-items: flex-start;
            justify-content: center;
        }

        .avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            object-fit: cover;
            background: var(--surface-soft);
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.2);
        }

        .placeholder {
            background: #1e1f22;
        }

        .message-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            align-items: baseline;
            margin-bottom: 6px;
        }

        .username {
            font-weight: 700;
            color: #f2f3f5;
        }

        .author-tag,
        .author-id,
        time,
        .muted,
        .attachments span {
            color: var(--muted);
        }

        .message-content {
            line-height: 1.5;
            font-size: 15px;
            word-break: break-word;
            white-space: normal;
        }

        .message-content br + br {
            content: "";
            display: block;
            margin-top: 6px;
        }

        .md-heading {
            display: block;
            margin: 4px 0;
            font-weight: 700;
            color: #f5f3ff;
        }

        .heading-2 {
            font-size: 18px;
        }

        .heading-3 {
            font-size: 15px;
        }

        .md-quote {
            display: block;
            margin: 4px 0;
            padding-left: 12px;
            border-left: 3px solid rgba(182, 140, 237, 0.78);
            color: #ddd4f7;
        }

        .component-card {
            margin-top: 10px;
            padding: 14px;
            border-radius: 14px;
            border: 1px solid rgba(217, 164, 65, 0.24);
            background: linear-gradient(180deg, rgba(217, 164, 65, 0.12), rgba(217, 164, 65, 0.04));
        }

        .component-text {
            display: grid;
            gap: 10px;
        }

        .component-block {
            line-height: 1.55;
        }

        .component-buttons {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 12px;
        }

        .component-button {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            min-height: 34px;
            padding: 0 14px;
            border-radius: 10px;
            border: 1px solid rgba(217, 164, 65, 0.3);
            background: rgba(217, 164, 65, 0.18);
            color: #fff1cf;
            font-weight: 600;
            text-decoration: none;
        }

        .component-button.disabled {
            opacity: 0.62;
        }

        .embed-list,
        .attachments {
            margin-top: 10px;
        }

        .embed-card,
        .attachments {
            background: var(--embed);
            border: 1px solid var(--panel-border);
            border-radius: 12px;
            padding: 12px;
        }

        .embed-card {
            border-left: 4px solid #4f545c;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.02);
        }

        .embed-title,
        .attachments-title {
            font-weight: 700;
            margin-bottom: 6px;
        }

        .embed-author,
        .embed-footer,
        .embed-field-name {
            color: var(--muted);
            font-size: 12px;
            margin-bottom: 6px;
        }

        .embed-description,
        .embed-field-value {
            line-height: 1.4;
        }

        .embed-fields {
            display: grid;
            gap: 8px;
            margin-top: 8px;
        }

        .attachments ul {
            margin: 0;
            padding-left: 18px;
        }

        .attachments li + li {
            margin-top: 6px;
        }

        a {
            color: var(--accent-strong);
            text-decoration: none;
        }

        a:hover {
            text-decoration: underline;
        }

        .mention {
            display: inline-block;
            border-radius: 4px;
            padding: 0 4px;
            background: rgba(217, 164, 65, 0.16);
            color: #ffe3a5;
        }

        .inline-code {
            background: var(--surface-soft);
            border: 1px solid var(--line);
            border-radius: 4px;
            font-family: Consolas, "Courier New", monospace;
            font-size: 0.92em;
            padding: 1px 5px;
        }

        .code-block {
            margin: 8px 0 0;
            padding: 12px;
            background: #111214;
            border: 1px solid var(--line);
            border-radius: 8px;
            overflow-x: auto;
            font-family: Consolas, "Courier New", monospace;
            line-height: 1.45;
        }

        .custom-emoji-wrap {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            vertical-align: middle;
        }

        .custom-emoji {
            width: 22px;
            height: 22px;
            object-fit: contain;
            vertical-align: middle;
        }

        .emoji-name {
            color: var(--muted);
            font-size: 0.92em;
        }

        .empty-state {
            background: var(--panel);
            border: 1px dashed var(--panel-border);
            color: var(--muted);
            padding: 24px;
            border-radius: 14px;
            text-align: center;
        }

        @media (max-width: 640px) {
            body {
                padding: 12px 8px 24px;
            }

            .header,
            .message {
                border-radius: 8px;
                padding: 12px;
            }

            .message {
                grid-template-columns: 1fr;
            }

            .avatar-wrap {
                justify-content: flex-start;
            }
        }
    </style>
</head>
<body>
    <main class="container">
        <section class="header">
            <div class="eyebrow">Orbit Transcript</div>
            <h1>${escapeHtml(title)}</h1>
            <div class="subtitle">${escapeHtml(subtitle)}</div>
            <div class="timeline">
                <div class="timeline-card">
                    <div class="stat-label">Opened</div>
                    <div class="stat-value">${escapeHtml(openedLabel)}</div>
                </div>
                <div class="timeline-card">
                    <div class="stat-label">Last Activity</div>
                    <div class="stat-value">${escapeHtml(closedLabel)}</div>
                </div>
                <div class="timeline-card">
                    <div class="stat-label">Generated</div>
                    <div class="stat-value">${escapeHtml(generatedLabel)}</div>
                </div>
            </div>
            <div class="stats">
                <div class="stat">
                    <div class="stat-label">Channel ID</div>
                    <div class="stat-value">${escapeHtml(channel.id)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Generated</div>
                    <div class="stat-value">${escapeHtml(generatedLabel)}</div>
                </div>
                <div class="stat">
                    <div class="stat-label">Messages</div>
                    <div class="stat-value">${escapeHtml(messages.length)}</div>
                </div>
            </div>
            ${participantSummary.length ? `
            <div class="participants">
                <div class="participants-title">Top Participants</div>
                <div class="participant-list">
                    ${participantSummary.map((participant) => `
                        <div class="participant-chip">
                            <span>${escapeHtml(participant.username)}</span>
                            <span class="participant-count">${escapeHtml(participant.count)}</span>
                        </div>
                    `).join('')}
                </div>
            </div>` : ''}
        </section>
        <section class="message-list">
            ${messages.length ? messages.map(renderMessage).join('') : '<div class="empty-state">No messages were found in this thread.</div>'}
        </section>
    </main>
</body>
</html>`;
}

async function createTranscriptAttachment(channel, ticketId) {
    const messages = await fetchAllMessages(channel);
    const content = buildTranscriptHtml(channel, ticketId, messages);
    const buffer = Buffer.from(content, 'utf8');
    const safeTicketId = safeFilePart(ticketId);

    return new AttachmentBuilder(buffer, {
        name: `transcript-${safeTicketId}.html`,
        description: `HTML transcript for ${ticketId}`
    });
}

module.exports = {
    createTranscriptAttachment
};
