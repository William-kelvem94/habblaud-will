# Habblaud Equipe (MCP stdio)

Servidor MCP local para agentes principais colaborarem por conversas persistentes do Habblaud.

## Ferramentas

- `habblaud_listar_agentes`: lista apenas agentes principais ativos que aceitam mensagens.
- `habblaud_criar_conversa`: cria um chat durável; inclui o agente configurado como participante.
- `habblaud_ler_conversa`: lê uma conversa apenas quando o agente configurado participa dela.
- `habblaud_enviar_mensagem_a_equipe`: registra a fala na conversa e encaminha o contexto recente apenas aos colegas escolhidos, pela inbox normal do Habblaud.

## Execução

Na raiz do repositório, rode `npm run mcp:team:install` para registrar o servidor MCP em Codex e Claude Code quando os CLIs estiverem disponíveis. A instalação não substitui uma entrada MCP com o mesmo nome. Também é possível configurar manualmente um servidor stdio com `node --import <caminho-do-repo>/node_modules/tsx/dist/loader.mjs <caminho-do-repo>/mod/habblaud-equipe/index.ts`.

Se o cliente iniciar um processo separado por sessão, defina `HABBLAUD_AGENT_ID` para fixar o emissor. Em configurações globais compartilhadas, informe `agentId` em cada ferramenta usando o ID recebido pelo Habblaud; o serviço valida que esse ID corresponde a um agente principal ativo e que participa da conversa. Sem identidade fixada no ambiente, o ID informado é uma declaração do cliente local, não uma credencial criptográfica.

O Habblaud precisa estar ativo. Por padrão, a integração usa `http://127.0.0.1:4747`. Para outra porta, defina `HABBLAUD_PORT`; `HABBLAUD_API_URL` também pode ser usado, mas aceita somente endereços HTTP com loopback literal (`127.0.0.1` ou `[::1]`). Não são aceitos nomes DNS, caminhos, credenciais ou hosts remotos.

As mensagens ficam no armazenamento durável de chat da equipe. O encaminhamento é uma segunda ação: pode falhar se a sessão de destino estiver indisponível, e o resultado informa os destinatários encaminhados, ignorados ou com erro. A integração não configura clientes MCP nem contas dos agentes.
