# 1. Apague a pasta src inteira (garante que nada antigo sobra escondido)
rm -rf src

# 2. Extraia o zip novo e copie a pasta src pra dentro do repositório
#    (ajuste o caminho pra onde você baixou o zip)
unzip -o ~/Downloads/kiai-atualizado.zip -d /tmp/kiai-novo
cp -r /tmp/kiai-novo/src ./src
cp /tmp/kiai-novo/package.json ./package.json
cp /tmp/kiai-novo/commands.ts ./src/commands.ts 2>/dev/null || true

# 3. Confirme que os arquivos novos estão lá
ls src/
# Precisa aparecer: duration.ts, delivery.ts, logging.ts, settings.ts, webhookSecurity.ts, format.ts (entre outros)

# 4. Adicione TUDO, sem exceção
git add -A
git status
# Confira aqui se aparece "new file: src/duration.ts" (ou modified, se já existia)

# 5. Commit e push
git commit -m "Cargo temporario, comandos de beneficios, ajustes de cartao"
git push