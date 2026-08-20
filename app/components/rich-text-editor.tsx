"use client";

import { useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";

/**
 * A minimal toolbar over TipTap's StarterKit — bold/italic/lists/link,
 * nothing that produces markup outside sanitizeMessageBody's allowlist
 * (app/lib/sanitize.ts), so nothing the toolbar can do ever gets stripped
 * back out on save. The HTML lives in a hidden input kept in sync via
 * onUpdate (TipTap's own DOM changes don't trigger a React re-render on
 * their own), which is what the surrounding <form> actually submits —
 * TipTap itself never touches the network.
 */
export function RichTextEditor({ name, placeholder }: { name: string; placeholder?: string }) {
  const [html, setHtml] = useState("");
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [StarterKit, Link.configure({ openOnClick: false })],
    editorProps: {
      attributes: {
        class: "min-h-[5rem] rounded-b border border-t-0 px-3 py-2 text-sm focus:outline-none prose-sm",
      },
    },
    onUpdate: ({ editor }) => setHtml(editor.getHTML()),
  });

  if (!editor) return null;

  const btn = (active: boolean) =>
    `rounded px-2 py-1 text-xs font-medium transition-colors ${active ? "bg-ink text-lily" : "hover:bg-silver-light"}`;

  return (
    <div>
      <div className="flex flex-wrap gap-1 rounded-t border border-b-0 bg-metal px-2 py-1.5">
        <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btn(editor.isActive("bold"))}>
          Bold
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btn(editor.isActive("italic"))}>
          Italic
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btn(editor.isActive("bulletList"))}>
          • List
        </button>
        <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btn(editor.isActive("orderedList"))}>
          1. List
        </button>
        <button
          type="button"
          onClick={() => {
            const url = window.prompt("Link URL");
            if (url) editor.chain().focus().setLink({ href: url }).run();
          }}
          className={btn(editor.isActive("link"))}
        >
          Link
        </button>
      </div>
      <EditorContent editor={editor} placeholder={placeholder} />
      <input type="hidden" name={name} value={html} readOnly />
    </div>
  );
}
