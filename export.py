import os

# โฟลเดอร์ที่ไม่อยากเอา
IGNORE = {'.git', 'node_modules', '__pycache__', '.vscode', 'venv', 'dist', 'build'}

with open('all-project.md', 'w', encoding='utf-8') as out:
    for root, dirs, files in os.walk('.'):
        # ข้ามโฟลเดอร์ขยะ
        dirs[:] = [d for d in dirs if d not in IGNORE]

        for file in files:
            if file.endswith(('.py', '.js', '.ts', '.html', '.css', '.json')): # เลือกนามสกุลที่อยากเอา
                path = os.path.join(root, file)
                try:
                    with open(path, 'r', encoding='utf-8') as f:
                        code = f.read()
                    # เขียนลง md
                    out.write(f"\n\n## {path}\n\n")
                    ext = file.split('.')[-1]
                    out.write(f"```{ext}\n{code}\n```\n")
                except:
                    pass

print("เสร็จแล้ว ได้ไฟล์ all-project.md")