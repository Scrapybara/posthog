import { expectLogic } from 'kea-test-utils'

import { databaseTableListLogic } from 'scenes/data-management/database/databaseTableListLogic'
import { sceneLogic } from 'scenes/sceneLogic'
import { teamLogic } from 'scenes/teamLogic'

import { useMocks } from '~/mocks/jest'
import { initKeaTests } from '~/test/init'

import { sqlEditorLogic } from './sqlEditorLogic'

jest.mock('lib/utils/kea-logic-builders', () => ({
    permanentlyMount: () => () => {},
}))

const describeBenchmark = process.env.SQL_EDITOR_LATENCY_BENCHMARK === '1' ? describe : describe.skip

interface BenchmarkModel {
    getValue: () => string
    setValue: (nextValue: string) => void
    getOffsetAt: (position: { lineNumber: number; column: number }) => number
    getPositionAt: (offset: number) => { lineNumber: number; column: number }
    getLineContent: (lineNumber: number) => string
    getLineCount: () => number
}

function createLargeSqlDocument(columnCount = 500): string {
    const fields = Array.from(
        { length: columnCount },
        (_, index) => `    properties['benchmark_property_${index}'] AS benchmark_column_${index}`
    )

    return [
        'SELECT',
        fields.join(',\n'),
        'FROM events',
        "WHERE event = 'benchmark_event'",
        '-- benchmark edit anchor ',
    ].join('\n')
}

function createBenchmarkModel(initialValue: string): BenchmarkModel {
    let value = initialValue
    let lineStarts = buildLineStarts(value)

    function setValue(nextValue: string): void {
        value = nextValue
        lineStarts = buildLineStarts(value)
    }

    return {
        getValue: () => value,
        setValue,
        getOffsetAt: ({ lineNumber, column }) => (lineStarts[lineNumber - 1] ?? 0) + column - 1,
        getPositionAt: (offset) => {
            const clampedOffset = Math.max(0, Math.min(offset, value.length))
            let lineIndex = 0
            for (let index = 0; index < lineStarts.length; index++) {
                if (lineStarts[index] > clampedOffset) {
                    break
                }
                lineIndex = index
            }
            return { lineNumber: lineIndex + 1, column: clampedOffset - lineStarts[lineIndex] + 1 }
        },
        getLineContent: (lineNumber) => {
            const start = lineStarts[lineNumber - 1] ?? 0
            const nextLineStart = lineStarts[lineNumber]
            return value.slice(start, nextLineStart === undefined ? undefined : nextLineStart - 1)
        },
        getLineCount: () => lineStarts.length,
    }
}

function buildLineStarts(value: string): number[] {
    const starts = [0]
    for (let index = 0; index < value.length; index++) {
        if (value[index] === '\n') {
            starts.push(index + 1)
        }
    }
    return starts
}

function createBenchmarkEditor(model: BenchmarkModel): any {
    let position = model.getPositionAt(model.getValue().length)
    let onDecorations: ((time: number) => void) | null = null

    return {
        onNextDecorations(callback: (time: number) => void): void {
            onDecorations = callback
        },
        setPosition(nextPosition: { lineNumber: number; column: number }): void {
            position = nextPosition
        },
        setModel: jest.fn(),
        focus: jest.fn(),
        getModel: () => model,
        getPosition: () => position,
        addOverlayWidget: jest.fn(),
        removeOverlayWidget: jest.fn(),
        onDidChangeCursorPosition: jest.fn(() => ({ dispose: jest.fn() })),
        onDidScrollChange: jest.fn(() => ({ dispose: jest.fn() })),
        onDidLayoutChange: jest.fn(() => ({ dispose: jest.fn() })),
        deltaDecorations: jest.fn((_oldDecorations, decorations) => {
            onDecorations?.(performance.now())
            onDecorations = null
            return decorations.map((_decoration: unknown, index: number) => `decoration-${index}`)
        }),
    }
}

function createMockMonaco(): any {
    return {
        Uri: {
            parse: (uri: string) => ({ toString: () => uri, path: uri }),
        },
        editor: {
            getModel: () => null,
            createModel: jest.fn(),
        },
    }
}

function percentile(values: number[], percentileValue: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    const index = Math.min(sorted.length - 1, Math.ceil((percentileValue / 100) * sorted.length) - 1)
    return sorted[index]
}

describeBenchmark('SQL editor large-document typing latency benchmark', () => {
    let logic: ReturnType<typeof sqlEditorLogic.build>
    let databaseLogic: ReturnType<typeof databaseTableListLogic.build>

    beforeEach(async () => {
        useMocks({
            get: {
                '/api/environments/:team_id/warehouse_saved_queries/': { results: [] },
                '/api/environments/:team_id/data_modeling_dags/': { results: [] },
                '/api/environments/:team_id/data_modeling_nodes/': { results: [] },
                '/api/environments/:team_id/data_modeling_edges/': { results: [] },
                '/api/environments/:team_id/data_modeling_jobs/recent/': [],
                '/api/environments/:team_id/data_modeling_jobs/running/': [],
                '/api/environments/:team_id/lineage/get_upstream/': { nodes: [], edges: [] },
                '/api/user_home_settings/@me/': {},
            },
            post: {
                '/api/environments/:team_id/query/': [200, { tables: {}, joins: [] }],
            },
            patch: {
                '/api/user_home_settings/@me/': [200],
            },
        })

        initKeaTests()
        teamLogic.mount()
        sceneLogic.mount()
        databaseLogic = databaseTableListLogic()
        databaseLogic.mount()
        sceneLogic.actions.setTabs([
            {
                id: 'benchmark-tab',
                title: 'SQL',
                pathname: '/sql',
                search: '',
                hash: '',
                active: true,
                iconType: 'blank',
            },
        ])
        await expectLogic(teamLogic).toFinishAllListeners()
    })

    afterEach(() => {
        logic?.unmount()
        databaseLogic?.unmount()
    })

    it('reports keypress-to-decoration latency for a deterministic large SQL document', async () => {
        const baseQuery = createLargeSqlDocument()
        const model = createBenchmarkModel(baseQuery)
        const editor = createBenchmarkEditor(model)
        const monaco = createMockMonaco()

        logic = sqlEditorLogic({ tabId: 'benchmark-tab', monaco, editor })
        logic.mount()

        await runMeasuredEdit(logic, editor, model, baseQuery).decoration

        const inputReadySamples: number[] = []
        const decorationSamples: number[] = []
        const syncSamples: number[] = []
        let query = baseQuery
        let latestDecoration: Promise<number> | null = null

        for (const character of 'abcdefghijkl') {
            query += character
            const result = runMeasuredEdit(logic, editor, model, query)
            const inputReadyMs = await result.inputReady
            latestDecoration = result.decoration
            inputReadySamples.push(inputReadyMs)
            syncSamples.push(result.syncMs)
        }

        if (latestDecoration) {
            const finalDecorationMs = await latestDecoration
            decorationSamples.push(finalDecorationMs)
        }

        const report = {
            documentBytes: new TextEncoder().encode(baseQuery).length,
            documentCharacters: baseQuery.length,
            samples: inputReadySamples.length,
            syncMedianMs: percentile(syncSamples, 50),
            syncP95Ms: percentile(syncSamples, 95),
            inputReadyMedianMs: percentile(inputReadySamples, 50),
            inputReadyP95Ms: percentile(inputReadySamples, 95),
            finalDecorationMs: decorationSamples[0],
        }

        // eslint-disable-next-line no-console
        console.log(`SQL_EDITOR_LATENCY_BENCHMARK ${JSON.stringify(report)}`)

        expect(inputReadySamples).toHaveLength(12)
    }, 60000)
})

function runMeasuredEdit(
    logic: ReturnType<typeof sqlEditorLogic.build>,
    editor: ReturnType<typeof createBenchmarkEditor>,
    model: BenchmarkModel,
    query: string
): { decoration: Promise<number>; inputReady: Promise<number>; syncMs: number } {
    model.setValue(query)
    editor.setPosition(model.getPositionAt(query.length))

    let start = 0
    const decoration = new Promise<number>((resolve) => {
        editor.onNextDecorations((finishedAt: number) => resolve(finishedAt - start))
    })

    start = performance.now()
    logic.actions.setQueryInput(query)
    const syncMs = performance.now() - start
    const inputReady = new Promise<number>((resolve) => {
        window.setTimeout(() => {
            const queryInputParseTimeout = logic.cache.queryInputParseTimeout as number | null | undefined
            if (queryInputParseTimeout) {
                window.clearTimeout(queryInputParseTimeout)
                logic.cache.queryInputParseTimeout = null
            }
            resolve(performance.now() - start)
        }, 0)
    })

    return { decoration, inputReady, syncMs }
}
