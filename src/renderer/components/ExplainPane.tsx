import './ExplainPane.css';

interface ExplanationData {
  summary: string;
  breakdown: string[];
  expectedOutcome: string;
  failureModes: string[];
  undoGuidance: string | null;
}

interface ExplainPaneProps {
  explanation: ExplanationData | null;
  isLoading: boolean;
  selectedCommand: any;
}

export default function ExplainPane({ explanation, isLoading, selectedCommand }: ExplainPaneProps) {
  return (
    <div className="pane explain-pane">
      <div className="pane-header">
        <span>Explain</span>
      </div>

      <div className="pane-content">
        {isLoading && (
          <div className="loading">
            <div className="spinner"></div>
            <p>Asking Claude...</p>
          </div>
        )}

        {!isLoading && !explanation && (
          <div className="empty-state">
            <p>Select a command from history or ask Claude a question</p>
          </div>
        )}

        {!isLoading && explanation && (
          <div className="explanation">
            {selectedCommand && (
              <div className="command-display">
                <code>{selectedCommand.input}</code>
              </div>
            )}

            <section>
              <h3>Summary</h3>
              <p>{explanation.summary}</p>
            </section>

            {explanation.breakdown && explanation.breakdown.length > 0 && (
              <section>
                <h3>Breakdown</h3>
                <ul>
                  {explanation.breakdown.map((item, i) => (
                    <li key={i}>{item}</li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.expectedOutcome && (
              <section>
                <h3>Expected Outcome</h3>
                <p>{explanation.expectedOutcome}</p>
              </section>
            )}

            {explanation.failureModes && explanation.failureModes.length > 0 && (
              <section>
                <h3>Common Failures</h3>
                <ul>
                  {explanation.failureModes.map((mode, i) => (
                    <li key={i}>{mode}</li>
                  ))}
                </ul>
              </section>
            )}

            {explanation.undoGuidance && (
              <section className="undo-section">
                <h3>How to Undo</h3>
                <p>{explanation.undoGuidance}</p>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
