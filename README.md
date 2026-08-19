# VozLivre

Uma plataforma original de comunidades em tempo real, inspirada no modelo mental de apps como Discord: espaços, canais, mensagens, presença e salas de voz/vídeo.

## Arquitetura

- `apps/web`: React + Vite, interface responsiva e cliente LiveKit.
- `apps/api`: NestJS, autorização de salas, tokens de mídia e gateway Socket.IO.
- PostgreSQL: fonte de verdade para usuários, espaços, membros, canais e mensagens.
- Redis: presença, fan-out e coordenação horizontal.
- LiveKit: SFU WebRTC para áudio, vídeo e compartilhamento de tela.

O tráfego de chat não passa pelo servidor de mídia. O navegador pede ao backend um token curto e limitado à sala; a chave secreta do LiveKit nunca chega ao cliente.

A autenticação usa e-mail e senha com hash bcrypt. A sessão fica em cookie `HttpOnly`, e tanto o chat quanto a emissão de tokens de chamada obtêm a identidade no backend.

As contas começam sem comunidades vinculadas. Cada pessoa pode criar explicitamente uma comunidade própria ou entrar em uma existente por convite. As comunidades são privadas: apenas membros associados diretamente ou por um convite válido conseguem listar canais, entrar no chat ou obter tokens de voz. Proprietários e administradores podem criar canais de texto/voz e gerar convites com validade de sete dias.

As salas de voz aparecem dentro da lista de canais com seus participantes e controles de conexão. A presença é sincronizada em tempo real para todos os membros da comunidade: o nome aparece ao conectar e é removido ao sair, trocar de canal ou perder a conexão. A visualização ampliada para vídeo e compartilhamento de tela ocupa a área central do aplicativo, sem abrir uma janela modal.

## Executar

1. Copie `.env.example` para `.env`.
2. `pnpm install`
3. `pnpm infra:up`
4. `pnpm --filter api exec prisma migrate deploy`
5. `pnpm dev`
6. Abra `http://localhost:5173`.

As contas já são persistidas no PostgreSQL; as mensagens ainda ficam em memória para permitir validar o chat rapidamente. Persistência do histórico e permissões por espaço entram no próximo corte.

## Créditos e licença

VozLivre foi criado por [Axel Foley](https://github.com/axelfvm).

O código é aberto sob a licença [BSD 3-Clause](LICENSE). Você pode usar, modificar e redistribuir o projeto, inclusive em trabalhos derivados, desde que mantenha o aviso de copyright, as condições da licença e os créditos ao autor conforme exigido pelo arquivo `LICENSE`.
