import { makeRemotelyCallable, remoteFunction } from 'src/util/webextensionRPC'
import DirectLinkingBackend from './backend'
import { setupRequestInterceptor } from './redirect'
import { AnnotationRequests } from './request'
import DirectLinkingStorage from './storage'
import normalize from '../../util/encode-url-for-id'

export default class DirectLinkingBackground {
    constructor({ storageManager }) {
        this.backend = new DirectLinkingBackend()
        this.storage = new DirectLinkingStorage({ storageManager })
        this.sendAnnotation = ({ tabId, annotation }) => {
            browser.tabs.sendMessage(tabId, { type: 'direct-link', annotation })
        }
        this.requests = new AnnotationRequests(
            this.backend,
            this.sendAnnotation,
        )
    }

    setupRemoteFunctions() {
        makeRemotelyCallable(
            {
                followAnnotationRequest: (...params) => {
                    this.followAnnotationRequest(...params)
                },
                createDirectLink: (...params) => {
                    return this.createDirectLink(...params)
                },
                getAllAnnotations: (...params) => {
                    return this.getAllAnnotationsByUrl(...params)
                },
                createComment: (...params) => {
                    return this.createComment(...params)
                },
                editAnnotation: (...params) => {
                    return this.editAnnotation(...params)
                },
                deleteAnnotation: (...params) => {
                    return this.deleteAnnotation(...params)
                },
            },
            { insertExtraArg: true },
        )
    }

    setupRequestInterceptor() {
        setupRequestInterceptor({
            requests: this.requests,
            webRequest: browser.webRequest,
        })
    }

    async triggerSidebar() {
        const [currentTab] = await browser.tabs.query({
            active: true,
            currentWindow: true,
        })
        await remoteFunction('openSidebarOverlay', { tabId: currentTab.id })()
    }

    followAnnotationRequest({ tab }) {
        this.requests.followAnnotationRequest(tab.id)
    }

    async createDirectLink({ tab }, request) {
        const pageTitle = tab.title
        const result = await this.backend.createDirectLink(request)
        await this.storage.insertDirectLink({
            pageTitle,
            pageUrl: normalize(tab.url),
            body: request.anchor.quote,
            url: result.url,
            selector: request.anchor,
        })

        // Attempt to (re-)index, if user preference set, but don't wait for it
        this.storage.indexPageFromTab(tab)

        await this.triggerSidebar()
        return result
    }

    async getAllAnnotationsByUrl({ tab }, url) {
        let pageUrl = url === null ? tab.url : url
        pageUrl = normalize(pageUrl)
        const annotations = await this.storage.getAnnotationsByUrl(pageUrl)

        return annotations.map(annotation => ({
            ...annotation,
            createdWhen: annotation.createdWhen.getTime(),
        }))
    }

    async createComment({ tab }, { url, title, comment }) {
        const pageUrl = url === null ? tab.url : url
        const pageTitle = title === null ? tab.title : title
        return await this.storage.createComment({
            pageTitle: normalize(pageTitle),
            pageUrl,
            comment,
        })
    }

    async editAnnotation({ tab }, pk, comment) {
        return await this.storage.editAnnotation(pk, comment)
    }

    async deleteAnnotation({ tab }, pk) {
        return await this.storage.deleteAnnotation(pk)
    }
}
